import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config';
import type { AppEnv, Services } from './context';
import { renameUser } from './identity';
import { requireMembership, withIdentity, withServices } from './middleware';
import { shareRoutes, tripRoutes } from './routes/trips';
import { syncRoutes } from './routes/sync';

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

  app.use('/api/*', withServices(services), withIdentity);

  /** Who the browser is currently acting as. */
  app.get('/api/me', (c) => c.json(c.var.identity));

  app.patch('/api/me', async (c) => {
    const body = await c.req.json().catch(() => null);
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName) return c.json({ error: 'bad_request' }, 400);

    renameUser(c.var.services.db, c.var.identity.userId, displayName.slice(0, 80));
    return c.json({ ...c.var.identity, displayName });
  });

  app.route('/api/trips', tripRoutes());
  app.route('/api/share', shareRoutes());

  // Membership is resolved once here rather than inside the sync handler, so
  // the same check guards every route added under this prefix later.
  app.use('/api/sync/:tripId', requireMembership);
  app.route('/api/sync', syncRoutes());

  return app;
}
