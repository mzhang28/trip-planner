import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Every default here points at something local, so `pnpm dev` works with no
 * environment set and nothing external running.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),

  /** Where the SQLite file lives, relative to the repository root. */
  DATABASE_PATH: z.string().default('data/trip-planner.db'),

  /** `fs` keeps attachments on disk; `s3` is configured in stage 5. */
  BLOB_STORE: z.enum(['fs', 's3']).default('fs'),
  BLOB_DIR: z.string().default('data/blobs'),

  /**
   * The origin this server is reached at. It is the OAuth issuer and the
   * resource identifier that access tokens are bound to, so it has to be the
   * URL clients actually use, not one inferred per request — inferring it from
   * the Host header would let a caller mint tokens for an audience of their
   * choosing.
   */
  PUBLIC_URL: z.string().url().default('http://localhost:8787'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Environment is not usable:\n${problems}`);
}

const repoRoot = resolve(import.meta.dirname, '../../..');

export const config = {
  ...parsed.data,
  databasePath: resolve(repoRoot, parsed.data.DATABASE_PATH),
  blobDir: resolve(repoRoot, parsed.data.BLOB_DIR),
  isProduction: parsed.data.NODE_ENV === 'production',
} as const;
