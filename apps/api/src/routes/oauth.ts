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

/**
 * The scopes in a request, or null if it asked for one that does not exist.
 *
 * An unknown scope is refused rather than dropped. A client that asked for
 * something this server has never heard of has misunderstood what it is talking
 * to, and silently handing back a smaller grant lets it believe it holds a
 * permission it does not.
 */
function readScope(raw: string | undefined): string | null {
  const asked = (raw ?? 'trips:read').split(/\s+/).filter(Boolean);
  if (asked.length === 0) return null;
  if (asked.some((entry) => !SCOPES.includes(entry as (typeof SCOPES)[number]))) return null;

  return [...new Set(asked)].join(' ');
}

/**
 * A redirect the code can be sent to without being readable on the way.
 *
 * Plain HTTP is allowed only back to the machine the browser is on, where the
 * response never crosses a network. Anywhere else it would put the code in
 * cleartext, and a code is all anyone needs to finish the exchange.
 */
export function redirectIsSafe(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:') return true;

    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

const consentSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  state: z.string().optional(),
  scope: z.string(),
  resource: z.string().optional(),
  code_challenge: z.string(),
  trip_ids: z.array(z.string()),
});

const denySchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  state: z.string().optional(),
});

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string(),
    redirect_uri: z.string(),
    client_id: z.string(),
    code_verifier: z.string(),
    client_secret: z.string().optional(),
    resource: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string(),
    client_id: z.string(),
    scope: z.string().optional(),
    client_secret: z.string().optional(),
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
      /*
       * A page in the app, not an endpoint on this server. This is the URL a
       * client opens in a browser, and what has to arrive there is the consent
       * screen; `/oauth/authorize` below it answers that screen in JSON and has
       * nothing to show a person.
       */
      authorization_endpoint: `${config.PUBLIC_URL}/connect`,
      token_endpoint: `${config.PUBLIC_URL}/oauth/token`,
      /*
       * No `registration_endpoint`. Clients are made by a person in the app and
       * configured with the credentials that produces, so there is nothing here
       * an agent could register itself against; advertising one would only get
       * a client as far as a 401.
       */
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

    const scope = readScope(query.scope);
    if (!scope) return c.json({ error: 'invalid_scope' }, 400);

    const mine = db
      .select({ id: trips.id, name: trips.name, role: tripMembers.role })
      .from(tripMembers)
      .innerJoin(trips, eq(trips.id, tripMembers.tripId))
      .where(eq(tripMembers.userId, c.var.identity.userId))
      .all();

    return c.json({
      client: { id: client.clientId, name: client.clientName, redirectOrigin: new URL(redirectUri).origin },
      scope,
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

    const scope = readScope(parsed.data.scope);
    if (!scope) return c.json({ error: 'invalid_scope' }, 400);

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
        scope,
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

  /**
   * Turning the request down, which the client is owed an answer about.
   *
   * The redirect is built here rather than in the page for the same reason the
   * approval is: the URI has to be checked against the ones the client
   * registered, and a browser cannot be the thing that decides that.
   */
  app.post('/authorize/deny', async (c) => {
    const { db } = c.var.services;
    const parsed = denySchema.safeParse(await c.req.json().catch(() => null));
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

    const location = new URL(parsed.data.redirect_uri);
    location.searchParams.set('error', 'access_denied');
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

    /*
     * A client that registered with a secret has to present it.
     *
     * Public clients are the ones MCP actually uses, and for them PKCE is what
     * proves the caller is the same one that started the flow. But a client
     * that was issued a secret and is never asked for it is a confidential
     * client in name only: anyone who learns its id can spend its codes.
     */
    const caller = db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, parsed.data.client_id))
      .get();

    if (!caller) return c.json({ error: 'invalid_client' }, 401);

    if (caller.clientSecretHash) {
      const header = c.req.header('authorization') ?? '';
      const basic = header.toLowerCase().startsWith('basic ')
        ? Buffer.from(header.slice(6).trim(), 'base64').toString().split(':')[1]
        : undefined;

      const presented = parsed.data.client_secret ?? basic;
      if (!presented || hashToken(presented) !== caller.clientSecretHash) {
        return c.json({ error: 'invalid_client' }, 401);
      }
    }

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
