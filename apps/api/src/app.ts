import { relative } from 'node:path';
import { TOMBSTONE_TTL_MS } from '@trip/crdt';
import { trips } from '@trip/schema';
import { serveStatic } from '@hono/node-server/serve-static';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config';
import type { AppEnv, Services } from './context';
import { renameUser } from './identity';
import { requireMembership, requireSession, withIdentity, withServices } from './middleware';
import { airportRoutes } from './routes/airports';
import { archiveRoutes } from './routes/archive';
import { auditRoutes } from './routes/audit';
import { blobRoutes } from './routes/blobs';
import { clientRoutes } from './routes/clients';
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
   * Puts one trip in the state it reaches after a sweep: tombstones removed,
   * and a watermark that makes the server refuse any document older than now.
   *
   * The watermark is set whether or not there was anything to remove, which the
   * nightly job does not do — it has no reason to make peers resync for a sweep
   * that changed nothing. Only mounted outside production, because it exists so
   * the tests can reach a state that otherwise takes thirty days to arrive.
   *
   * Named trip by trip. One database serves the whole test suite in parallel,
   * and marking every trip swept sent every other test's browser back for a
   * fresh copy mid-edit.
   */
  if (!config.isProduction) {
    app.post('/api/test/force-resync/:tripId', (c) => {
      const tripId = c.req.param('tripId');
      const swept = sweepAllTrips(services.db, services.docs, Date.now() + TOMBSTONE_TTL_MS + 1, [
        tripId,
      ]);
      services.db
        .update(trips)
        .set({ tombstonesSweptAt: Date.now() })
        .where(eq(trips.id, tripId))
        .run();

      return c.json({ swept });
    });
  }

  app.route('/oauth', oauthRoutes());
  /*
   * Uploading is guarded by trip membership when the client says which trip it
   * is for. Reading is not: a blob is named by its own hash, so knowing the
   * name is already knowing the contents.
  */
  app.route('/api/airports', airportRoutes());
  app.route('/api/blobs', blobRoutes());
  // Handing out credentials is not something a request that arrived without a
  // session should be able to do, whatever person it would be given on the way.
  app.use('/api/clients', requireSession);
  app.use('/api/clients/*', requireSession);
  app.route('/api/clients', clientRoutes());
  app.route('/api/places', placeRoutes());
  app.route('/api/weather', weatherRoutes());
  // Before the trip routes, so that /import is read as itself rather than as
  // the name of a trip.
  app.route('/api/trips', archiveRoutes());
  app.route('/api/trips', tripRoutes());
  app.route('/api/share', shareRoutes());

  // Membership is resolved once here rather than inside the sync handler, so
  // the same check guards every route added under this prefix later.
  app.use('/api/sync/:tripId', requireMembership);
  app.route('/api/sync', syncRoutes());

  app.use('/api/audit/:tripId', requireMembership);
  app.use('/api/audit/:tripId/*', requireMembership);
  app.route('/api/audit', auditRoutes());

  // Last, so a path this server answers itself is never mistaken for a file.
  if (config.webDist) serveWebApp(app, config.webDist);

  return app;
}

/** The paths this server answers, which the client must not be given for. */
const SERVER_PATHS = /^\/(api|oauth|mcp|\.well-known)(\/|$)/;

/**
 * Serves the built client beside the API, on one origin.
 *
 * That origin is what an agent's access token is bound to, and serving both
 * from here means there is nothing in front to keep in agreement with it. In
 * dev the Vite server does this instead, and proxies these paths back here.
 */
function serveWebApp(app: Hono<AppEnv>, dist: string) {
  // serveStatic joins its root onto the request path and rejects an absolute
  // one, so the configured directory is given relative to where we started.
  const root = relative(process.cwd(), dist) || '.';

  // Vite writes a content hash into every filename under /assets, so a cached
  // copy of one is never a stale copy. Everything else is asked about again:
  // index.html and the service worker decide when a new version is offered.
  const onFound = (_path: string, c: Context<AppEnv>) => {
    const immutable = c.req.path.startsWith('/assets/');
    c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  };

  // The build leaves a .gz beside anything worth compressing, and precompressed
  // hands that over when the client accepts it rather than gzipping per request.
  const file = serveStatic<AppEnv>({ root, precompressed: true, onFound });
  const indexHtml = serveStatic<AppEnv>({
    root,
    path: 'index.html',
    precompressed: true,
    onFound,
  });

  app.use('*', (c, next) => (SERVER_PATHS.test(c.req.path) ? next() : file(c, next)));

  // A trip URL opened directly is a route in the client, not a file on disk.
  // Anything the API owns has already been answered or has already 404ed.
  app.get('*', (c, next) => (SERVER_PATHS.test(c.req.path) ? next() : indexHtml(c, next)));
}
