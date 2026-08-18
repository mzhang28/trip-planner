import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import { createBlobStore } from './blobs';
import { createDb, runMigrations } from './db';
import { DocStore } from './docStore';
import { scheduleSweep } from './sweep';

const { db } = createDb();
runMigrations(db, resolve(import.meta.dirname, '../drizzle'));

const docs = new DocStore(db);
const blobs = await createBlobStore();
const stopSweep = scheduleSweep(db, docs, blobs);

const app = createApp({ db, docs, blobs });

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) =>
  console.log(`api listening on http://${config.HOST}:${info.port}`),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopSweep();
    server.close(() => process.exit(0));
  });
}
