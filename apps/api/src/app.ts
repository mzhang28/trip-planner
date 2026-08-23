import { relative } from 'node:path';
import { createContextValues } from '@connectrpc/connect';
import { TOMBSTONE_TTL_MS } from '@trip/crdt';
import { trips } from '@trip/schema';
import { serveStatic } from '@hono/node-server/serve-static';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config';
import type { AppEnv, Services } from './context';
import {
  closeRegistration,
  isAdmin,
  openRegistration,
  registrationIsOpen,
  renameUser,
} from './identity';
import { requireMembership, requireSession, withIdentity, withServices } from './middleware';
import { airportRoutes } from './routes/airports';
import { archiveRoutes } from './routes/archive';
import { auditRoutes } from './routes/audit';
import { blobRoutes } from './routes/blobs';
import { calendarFeedRoutes, calendarRoutes } from './routes/calendar';
import { clientRoutes } from './routes/clients';
import { fileRoutes } from './routes/files';
import { mcpRoutes } from './routes/mcp';
import { metadataRoutes, oauthRoutes } from './routes/oauth';
import { placeRoutes, weatherRoutes } from './routes/places';
import { shareRoutes, tripRoutes } from './routes/trips';
import { connectHandler } from './sync/connect';
import { identityContext, syncService } from './sync/service';
import { SyncSessions } from './sync/sessions';
import { sweepAllTrips } from './sweep';

export function createApp(services: Services) {
  const app = new Hono<AppEnv>();

  // Everyone with a trip open right now. Held per app rather than per request,
  // because carrying one person's edit to another person is the whole point.
  const sessions = new SyncSessions(services.docs);

  // Every request, in production too. A client that says only that it could not
  // connect leaves nothing to go on, and whether the request arrived at all is
  // the first thing worth knowing.
  app.use('*', logger());

  /*
   * Why a request was turned away, which the status alone does not say.
   *
   * A refusal is a plain reply rather than a thrown error, so nothing below
   * would otherwise record it: an agent stuck on a 401 and a server with no
   * sign of it is the case this exists for.
   */
  app.use('*', async (c, next) => {
    await next();

    if (c.res.status >= 400) {
      const reason = c.res.headers.get('WWW-Authenticate');
      console.warn(
        `${c.req.method} ${c.req.path} refused with ${c.res.status}`,
        reason ? `(${reason})` : '',
      );
    }
  });

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

  // A signed file link carries its own permission, so this stays clear of the
  // middleware that insists on a person. Nothing following one has a session.
  app.use('/files/*', withServices(services));
  app.route('/files', fileRoutes());

  /*
   * A calendar subscription, polled by whatever the person pasted the URL into.
   * Outside the middleware for the same reason: a calendar client has no cookie
   * and no way to be given one, so the token in the path is all it carries --
   * and minting a person for every poll would fill the table with one user per
   * refresh.
   */
  app.use('/calendar/*', withServices(services));
  app.route('/calendar', calendarRoutes());

  app.use('/api/*', withServices(services), withIdentity);

  /*
   * Only the authorize half of OAuth runs in a browser. `/oauth/token` and
   * `/oauth/revoke` are called by the agent's own server, which has no session
   * cookie and should never be given a person — a hosted client redeeming its
   * code would otherwise be turned away the moment registration closed.
   */
  app.use('/oauth/*', withServices(services));
  app.use('/oauth/authorize', withIdentity);
  app.use('/oauth/authorize/*', withIdentity);

  /** Who the browser is currently acting as, and what they may do to the server. */
  app.get('/api/me', (c) =>
    c.json({
      ...c.var.identity,
      admin: isAdmin(services.db, c.var.identity.userId),
      registrationOpen: registrationIsOpen(services.db),
    }),
  );

  /**
   * Whether a stranger arriving may have an account made for them.
   *
   * Shut behind the first person to arrive. Opening it again is how somebody
   * else gets in without a share link — which otherwise remains the only way.
   */
  app.patch('/api/instance', async (c) => {
    if (!isAdmin(services.db, c.var.identity.userId)) return c.json({ error: 'not_admin' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.registrationOpen !== 'boolean') return c.json({ error: 'bad_request' }, 400);

    if (body.registrationOpen) openRegistration(services.db);
    else closeRegistration(services.db);

    return c.json({ registrationOpen: body.registrationOpen });
  });

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
  app.route('/api/trips', calendarFeedRoutes());
  app.route('/api/trips', tripRoutes());
  app.route('/api/share', shareRoutes());

  /*
   * Sync is the one part of the API that is not REST.
   *
   * It needs the server to speak first -- someone with the trip open should see
   * another person's edit without having asked for it -- and a request/response
   * endpoint has no way to do that. The handlers sit under /api so that the
   * session cookie is resolved by the same middleware as everything else.
   */
  const rpc = connectHandler(syncService(services, sessions), { prefix: '/api/rpc' });
  app.all('/api/rpc/*', (c) =>
    rpc(c.req.raw, createContextValues().set(identityContext, c.var.identity)),
  );

  app.use('/api/audit/:tripId', requireMembership);
  app.use('/api/audit/:tripId/*', requireMembership);
  app.route('/api/audit', auditRoutes());

  // Last, so a path this server answers itself is never mistaken for a file.
  if (config.webDist) serveWebApp(app, config.webDist);

  return app;
}

/** The paths this server answers, which the client must not be given for. */
const SERVER_PATHS = /^\/(api|oauth|mcp|files|calendar|\.well-known)(\/|$)/;

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
