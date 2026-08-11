import { createHash, randomBytes } from 'node:crypto';
import { oauthAuthCodes, oauthClients, oauthTokens, tripMembers, trips } from '@trip/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config';
import type { AppEnv } from '../context';
import { hashToken, token } from '../identity';

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

export const SCOPES = ['trips:read', 'trips:write'] as const;

/**
 * Loopback is allowed on any port because a desktop MCP client binds whatever
 * port is free and cannot register it in advance. Everything else has to match
 * exactly, so no redirect can be constructed that the client did not register.
 */
function redirectAllowed(registered: string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;

  try {
    const url = new URL(candidate);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false;

    return registered.some((entry) => {
      try {
        const known = new URL(entry);
        return (
          (known.hostname === '127.0.0.1' || known.hostname === 'localhost') &&
          known.pathname === url.pathname
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** RFC 7636 S256: the verifier hashed and base64url-encoded must equal the challenge. */
function verifierMatches(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return computed === challenge;
}

const registerSchema = z.object({
  client_name: z.string().min(1).max(200).default('An MCP client'),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).default('none'),
});

const consentSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  state: z.string().optional(),
  scope: z.string(),
  resource: z.string().optional(),
  code_challenge: z.string(),
  trip_ids: z.array(z.string()),
});

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string(),
    redirect_uri: z.string(),
    client_id: z.string(),
    code_verifier: z.string(),
    resource: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string(),
    client_id: z.string(),
    scope: z.string().optional(),
    resource: z.string().optional(),
  }),
]);

export function metadataRoutes() {
  const app = new Hono<AppEnv>();

  /** RFC 9728. Tells a client where to go to get a token for this server. */
  app.get('/oauth-protected-resource', (c) =>
    c.json({
      resource: config.PUBLIC_URL,
      authorization_servers: [config.PUBLIC_URL],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
    }),
  );

  /** RFC 8414. */
  app.get('/oauth-authorization-server', (c) =>
    c.json({
      issuer: config.PUBLIC_URL,
      authorization_endpoint: `${config.PUBLIC_URL}/oauth/authorize`,
      token_endpoint: `${config.PUBLIC_URL}/oauth/token`,
      registration_endpoint: `${config.PUBLIC_URL}/oauth/register`,
      revocation_endpoint: `${config.PUBLIC_URL}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // S256 only. `plain` offers no protection against an intercepted code,
      // which is the entire thing PKCE exists to stop.
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: SCOPES,
    }),
  );

  return app;
}

export function oauthRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/register', async (c) => {
    const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid_client_metadata' }, 400);
    }

    const { db } = c.var.services;
    const clientId = `mcp_${token(16)}`;
    const isPublic = parsed.data.token_endpoint_auth_method === 'none';
    const secret = isPublic ? null : token();

    db.insert(oauthClients)
      .values({
        id: `oc_${token(12)}`,
        clientId,
        clientSecretHash: secret ? hashToken(secret) : null,
        clientName: parsed.data.client_name,
        redirectUris: JSON.stringify(parsed.data.redirect_uris),
        tokenEndpointAuthMethod: parsed.data.token_endpoint_auth_method,
        createdAt: Date.now(),
      })
      .run();

    return c.json(
      {
        client_id: clientId,
        ...(secret ? { client_secret: secret } : {}),
        client_name: parsed.data.client_name,
        redirect_uris: parsed.data.redirect_uris,
        token_endpoint_auth_method: parsed.data.token_endpoint_auth_method,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      201,
    );
  });

  /**
   * What the consent screen needs to describe the request.
   *
   * The browser calls this, renders the screen, and posts back what was ticked.
   * Keeping the decision in the app rather than in a server-rendered page means
   * the person picking trips sees the same interface they already know.
   */
  app.get('/authorize', (c) => {
    const { db } = c.var.services;
    const query = c.req.query();

    const client = db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, query.client_id ?? ''))
      .get();

    if (!client) return c.json({ error: 'invalid_client' }, 400);

    const redirectUri = query.redirect_uri ?? '';
    if (!redirectAllowed(JSON.parse(client.redirectUris) as string[], redirectUri)) {
      // Answered here rather than by redirecting: sending an error to an
      // unverified URI is itself the open redirect being guarded against.
      return c.json({ error: 'invalid_redirect_uri' }, 400);
    }

    if (query.response_type !== 'code') return c.json({ error: 'unsupported_response_type' }, 400);
    if (query.code_challenge_method !== 'S256' || !query.code_challenge) {
      return c.json({ error: 'invalid_request', error_description: 'S256 PKCE is required' }, 400);
    }

    const mine = db
      .select({ id: trips.id, name: trips.name, role: tripMembers.role })
      .from(tripMembers)
      .innerJoin(trips, eq(trips.id, tripMembers.tripId))
      .where(eq(tripMembers.userId, c.var.identity.userId))
      .all();

    return c.json({
      client: { id: client.clientId, name: client.clientName, redirectOrigin: new URL(redirectUri).origin },
      scope: query.scope ?? 'trips:read',
      resource: query.resource,
      trips: mine,
      you: c.var.identity,
    });
  });

  app.post('/authorize/consent', async (c) => {
    const { db } = c.var.services;
    const parsed = consentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const client = db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, parsed.data.client_id))
      .get();

    if (!client) return c.json({ error: 'invalid_client' }, 400);
    if (!redirectAllowed(JSON.parse(client.redirectUris) as string[], parsed.data.redirect_uri)) {
      return c.json({ error: 'invalid_redirect_uri' }, 400);
    }

    /*
     * Only trips this person actually holds. Without this filter a client could
     * name any trip id in the request and be granted access to it by a consent
     * screen the person never saw the contents of.
     */
    const held = new Set(
      db
        .select({ id: tripMembers.tripId })
        .from(tripMembers)
        .where(eq(tripMembers.userId, c.var.identity.userId))
        .all()
        .map((row) => row.id),
    );

    const granted = parsed.data.trip_ids.filter((id) => held.has(id));

    const code = token();
    db.insert(oauthAuthCodes)
      .values({
        codeHash: hashToken(code),
        clientId: client.clientId,
        userId: c.var.identity.userId,
        redirectUri: parsed.data.redirect_uri,
        scope: parsed.data.scope,
        resource: parsed.data.resource ?? config.PUBLIC_URL,
        codeChallenge: parsed.data.code_challenge,
        codeChallengeMethod: 'S256',
        grantedTripIds: JSON.stringify(granted),
        expiresAt: Date.now() + CODE_TTL_MS,
      })
      .run();

    const location = new URL(parsed.data.redirect_uri);
    location.searchParams.set('code', code);
    if (parsed.data.state) location.searchParams.set('state', parsed.data.state);

    return c.json({ redirect_to: location.toString() });
  });

  app.post('/token', async (c) => {
    const { db } = c.var.services;

    const form = c.req.header('content-type')?.includes('application/json')
      ? await c.req.json().catch(() => null)
      : Object.fromEntries((await c.req.formData()).entries());

    const parsed = tokenSchema.safeParse(form);
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const now = Date.now();

    if (parsed.data.grant_type === 'authorization_code') {
      const { code, code_verifier, redirect_uri, client_id, resource } = parsed.data;

      const record = db
        .select()
        .from(oauthAuthCodes)
        .where(eq(oauthAuthCodes.codeHash, hashToken(code)))
        .get();

      if (!record || record.usedAt !== null || record.expiresAt < now) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      if (record.clientId !== client_id || record.redirectUri !== redirect_uri) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      if (!verifierMatches(code_verifier, record.codeChallenge)) {
        return c.json({ error: 'invalid_grant', error_description: 'PKCE check failed' }, 400);
      }

      // Single use, marked before anything is issued so two requests racing on
      // one code cannot both succeed.
      db.update(oauthAuthCodes)
        .set({ usedAt: now })
        .where(eq(oauthAuthCodes.codeHash, record.codeHash))
        .run();

      return c.json(
        issue(c, {
          clientId: client_id,
          userId: record.userId,
          scope: record.scope,
          resource: resource ?? record.resource ?? config.PUBLIC_URL,
          grantedTripIds: record.grantedTripIds,
          familyId: `fam_${token(12)}`,
        }),
      );
    }

    const existing = db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.tokenHash, hashToken(parsed.data.refresh_token)),
          eq(oauthTokens.type, 'refresh'),
        ),
      )
      .get();

    if (!existing || existing.clientId !== parsed.data.client_id) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    if (existing.revokedAt !== null || existing.expiresAt < now) {
      /*
       * A rotated refresh token being presented again means it leaked: the
       * legitimate holder has a newer one. Which of the two is the attacker
       * cannot be known, so the whole family goes.
       */
      db.update(oauthTokens)
        .set({ revokedAt: now })
        .where(eq(oauthTokens.familyId, existing.familyId))
        .run();

      return c.json({ error: 'invalid_grant', error_description: 'token reuse detected' }, 400);
    }

    db.update(oauthTokens).set({ revokedAt: now }).where(eq(oauthTokens.id, existing.id)).run();

    return c.json(
      issue(c, {
        clientId: existing.clientId,
        userId: existing.userId,
        scope: parsed.data.scope ?? existing.scope,
        resource: parsed.data.resource ?? existing.resource ?? config.PUBLIC_URL,
        grantedTripIds: existing.grantedTripIds,
        familyId: existing.familyId,
      }),
    );
  });

  app.post('/revoke', async (c) => {
    const { db } = c.var.services;
    const form = Object.fromEntries((await c.req.formData().catch(() => new FormData())).entries());
    const value = typeof form.token === 'string' ? form.token : '';

    if (value) {
      db.update(oauthTokens)
        .set({ revokedAt: Date.now() })
        .where(and(eq(oauthTokens.tokenHash, hashToken(value)), isNull(oauthTokens.revokedAt)))
        .run();
    }

    // RFC 7009 asks for 200 whether or not the token existed, so a caller
    // cannot use this endpoint to find out which tokens are real.
    return c.body(null, 200);
  });

  return app;
}

interface GrantDetails {
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
  grantedTripIds: string;
  familyId: string;
}

function issue(c: { var: { services: { db: AppEnv['Variables']['services']['db'] } } }, grant: GrantDetails) {
  const { db } = c.var.services;
  const now = Date.now();

  const accessToken = token();
  const refreshToken = token();

  db.insert(oauthTokens)
    .values([
      {
        id: `at_${token(12)}`,
        tokenHash: hashToken(accessToken),
        type: 'access',
        clientId: grant.clientId,
        userId: grant.userId,
        scope: grant.scope,
        resource: grant.resource,
        grantedTripIds: grant.grantedTripIds,
        familyId: grant.familyId,
        expiresAt: now + ACCESS_TTL_MS,
        createdAt: now,
      },
      {
        id: `rt_${token(12)}`,
        tokenHash: hashToken(refreshToken),
        type: 'refresh',
        clientId: grant.clientId,
        userId: grant.userId,
        scope: grant.scope,
        resource: grant.resource,
        grantedTripIds: grant.grantedTripIds,
        familyId: grant.familyId,
        expiresAt: now + REFRESH_TTL_MS,
        createdAt: now,
      },
    ])
    .run();

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: grant.scope,
  };
}

export interface AccessContext {
  userId: string;
  clientId: string;
  scope: string;
  grantedTripIds: string[];
}

/** Verifies a bearer token and says what it is allowed to reach. */
export function verifyAccessToken(
  db: AppEnv['Variables']['services']['db'],
  raw: string,
): AccessContext | null {
  const row = db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, hashToken(raw)), eq(oauthTokens.type, 'access')))
    .get();

  if (!row || row.revokedAt !== null || row.expiresAt < Date.now()) return null;

  /*
   * The audience check. A token minted for another service and replayed here
   * must not work, which is the confused-deputy problem RFC 8707 exists for.
   */
  if (row.resource && row.resource !== config.PUBLIC_URL) return null;

  return {
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    grantedTripIds: JSON.parse(row.grantedTripIds) as string[],
  };
}

export function randomVerifier(): string {
  return randomBytes(32).toString('base64url');
}
