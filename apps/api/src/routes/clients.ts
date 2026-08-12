import { oauthAuthCodes, oauthClients, oauthTokens } from '@trip/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { hashToken, token } from '../identity';
import { redirectIsSafe } from './oauth';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  redirectUris: z.array(z.string().url().refine(redirectIsSafe)).min(1).max(10),
  /**
   * Whether the agent can keep a secret.
   *
   * A hosted one runs on a server nobody else can read, so it can. Anything
   * that ships to a person's machine cannot: the same secret would be inside
   * every copy, which makes it a password everyone knows.
   */
  confidential: z.boolean().default(false),
});

/**
 * The agents a person has made, and the credentials to configure them with.
 *
 * The secret is returned by the call that creates it and never again. Only its
 * hash is stored, so showing it a second time is not something this could do
 * even if the screen wanted to.
 */
export function clientRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const { db } = c.var.services;

    const rows = db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.ownerUserId, c.var.identity.userId))
      .all();

    return c.json({
      clients: rows
        .map((row) => ({
          clientId: row.clientId,
          name: row.clientName,
          redirectUris: JSON.parse(row.redirectUris) as string[],
          confidential: row.clientSecretHash !== null,
          createdAt: row.createdAt,
          /** How many grants are live, which is what revoking would end. */
          grants: db
            .select({ id: oauthTokens.id })
            .from(oauthTokens)
            .where(
              and(
                eq(oauthTokens.clientId, row.clientId),
                eq(oauthTokens.type, 'refresh'),
                isNull(oauthTokens.revokedAt),
              ),
            )
            .all().length,
        }))
        .sort((a, b) => b.createdAt - a.createdAt),
    });
  });

  app.post('/', async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_client_metadata' }, 400);

    const { db } = c.var.services;
    const clientId = `mcp_${token(16)}`;
    const secret = parsed.data.confidential ? token() : null;

    db.insert(oauthClients)
      .values({
        id: `oc_${token(12)}`,
        clientId,
        clientSecretHash: secret ? hashToken(secret) : null,
        clientName: parsed.data.name,
        redirectUris: JSON.stringify(parsed.data.redirectUris),
        tokenEndpointAuthMethod: secret ? 'client_secret_post' : 'none',
        ownerUserId: c.var.identity.userId,
        createdAt: Date.now(),
      })
      .run();

    return c.json(
      {
        clientId,
        // Named as the agent's own configuration will name it, so it can be
        // copied across without anyone having to translate.
        clientSecret: secret,
        name: parsed.data.name,
        redirectUris: parsed.data.redirectUris,
      },
      201,
    );
  });

  app.delete('/:clientId', (c) => {
    const { db } = c.var.services;
    const clientId = c.req.param('clientId');

    const row = db
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .where(
        and(
          eq(oauthClients.clientId, clientId),
          eq(oauthClients.ownerUserId, c.var.identity.userId),
        ),
      )
      .get();

    if (!row) return c.json({ error: 'no_such_client' }, 404);

    /*
     * Tokens first. Deleting the client alone would leave working access tokens
     * behind: nothing on the MCP path reads the client table, so an agent whose
     * registration had been taken away would carry on until its token expired.
     */
    db.update(oauthTokens)
      .set({ revokedAt: Date.now() })
      .where(and(eq(oauthTokens.clientId, clientId), isNull(oauthTokens.revokedAt)))
      .run();

    db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.clientId, clientId)).run();
    db.delete(oauthClients).where(eq(oauthClients.id, row.id)).run();

    return c.json({ ok: true });
  });

  return app;
}
