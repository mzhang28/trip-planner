import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config';

export function createApp() {
  const app = new Hono();

  if (!config.isProduction) {
    app.use('*', logger());
  }

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      // The web app checks this to tell "the server is down" apart from "this
      // device is offline", which are the same failure to fetch but different
      // things to tell the person.
      time: Date.now(),
    }),
  );

  return app;
}
