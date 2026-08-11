import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from '@trip/schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from './config';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Whatever can run a query: the connection, or a transaction on it.
 *
 * A transaction is not a `Db` — it has no `transaction` method of its own — so
 * a helper that must work both inside and outside one takes this instead.
 */
export type Executor = Pick<Db, 'insert' | 'select' | 'update' | 'delete'>;

export function createDb(path: string = config.databasePath) {
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);

  // Write-ahead logging lets the sync path read while a compaction writes,
  // instead of the two taking turns on one lock.
  sqlite.pragma('journal_mode = WAL');
  // Without this, a foreign key is documentation rather than a constraint.
  sqlite.pragma('foreign_keys = ON');
  // Wait rather than fail immediately when another connection holds the lock.
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

export function runMigrations(db: Db, folder: string): void {
  migrate(db, { migrationsFolder: folder });
}
