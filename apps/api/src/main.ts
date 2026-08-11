import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';

const server = serve(
  {
    fetch: createApp().fetch,
    port: config.PORT,
    hostname: config.HOST,
  },
  (info) => {
    console.log(`api listening on http://${config.HOST}:${info.port}`);
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
