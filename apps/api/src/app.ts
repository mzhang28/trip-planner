import { TOMBSTONE_TTL_MS } from '@trip/crdt';
import { trips } from '@trip/schema';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config';
import type { AppEnv, Services } from './context';
import { renameUser } from './identity';
import { requireMembership, withIdentity, withServices } from './middleware';
import { auditRoutes } from './routes/audit';
import { blobRoutes } from './routes/blobs';
import { mcpRoutes } from './routes/mcp';
import { metadataRoutes, oauthRoutes } from './routes/oauth';
import { placeRoutes, weatherRoutes } from './routes/places';
import { shareRoutes, tripRoutes } from './routes/trips';
import { syncRoutes } from './routes/sync';
import { sweepAllTrips } from './sweep';

export function createApp(services: Services) {
  const app = new Hono<AppEnv>();

  if (!config.isProduction) app.use('*', logger());

  /*
   * Answer in JSON even when something breaks. A client that gets HTML back
   * from a JSON endpoint reports a parse error, which says nothing about what
   * actually went wrong.
   */
  app.onError((error, c) => {
    console.error(`${c.req.method} ${c.req.path} failed`, error);
    return c.json({ error: 'internal', message: error.message }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, time: Date.now() }));

  /*
   * Discovery has to sit at the root rather than under /api. A client is given
   * the server's URL and looks for these paths on it; putting them anywhere
   * else means nothing finds them.
   */
  app.use('/.well-known/*', withServices(services));
  app.route('/.well-known', metadataRoutes());

  // The MCP endpoint carries a bearer token and never a session cookie, so it
  // stays outside the middleware that mints a person for anyone who asks.
  app.use('/mcp', withServices(services));
  app.route('/mcp', mcpRoutes());

  app.use('/api/*', withServices(services), withIdentity);
  app.use('/oauth/*', withServices(services), withIdentity);

  /** Who the browser is currently acting as. */
  app.get('/api/me', (c) => c.json(c.var.identity));

  app.patch('/api/me', async (c) => {
    const body = await c.req.json().catch(() => null);
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName) return c.json({ error: 'bad_request' }, 400);

    renameUser(c.var.services.db, c.var.identity.userId, displayName.slice(0, 80));
    return c.json({ ...c.var.identity, displayName });
  });

  /*
   * Puts the server in the state it reaches after a sweep: tombstones removed,
   * and a watermark that makes it refuse any document older than now.
   *
   * The watermark is set whether or not there was anything to remove, which the
   * nightly job does not do — it has no reason to make peers resync for a sweep
   * that changed nothing. Only mounted outside production, because it exists so
   * the tests can reach a state that otherwise takes thirty days to arrive.
   */
  if (!config.isProduction) {
    app.post('/api/test/force-resync', (c) => {
      const swept = sweepAllTrips(services.db, services.docs, Date.now() + TOMBSTONE_TTL_MS + 1);
      services.db.update(trips).set({ tombstonesSweptAt: Date.now() }).run();

      return c.json({ swept });
    });
  }

  app.route('/oauth', oauthRoutes());
  /*
   * Uploading is guarded by trip membership when the client says which trip it
   * is for. Reading is not: a blob is named by its own hash, so knowing the
   * name is already knowing the contents.
   */
  app.route('/api/blobs', blobRoutes());
  app.route('/api/places', placeRoutes());
  app.route('/api/weather', weatherRoutes());
  app.route('/api/trips', tripRoutes());
  app.route('/api/share', shareRoutes());

  // Membership is resolved once here rather than inside the sync handler, so
  // the same check guards every route added under this prefix later.
  app.use('/api/sync/:tripId', requireMembership);
  app.route('/api/sync', syncRoutes());

  app.use('/api/audit/:tripId', requireMembership);
  app.use('/api/audit/:tripId/*', requireMembership);
  app.route('/api/audit', auditRoutes());

  return app;
}
