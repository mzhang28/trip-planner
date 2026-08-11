import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import { createDb, runMigrations } from './db';
import { DocStore } from './docStore';

const { db } = createDb();
runMigrations(db, resolve(import.meta.dirname, '../drizzle'));

const app = createApp({ db, docs: new DocStore(db) });

const server = serve(
  { fetch: app.fetch, port: config.PORT, hostname: config.HOST },
  (info) => console.log(`api listening on http://${config.HOST}:${info.port}`),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
