import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Every default here points at something local, so `pnpm dev` works with no
 * environment set and nothing external running.
 */
const schema = z.object({
  // Port 0 asks the OS for an unused port, which keeps concurrent test runs
  // isolated without a race-prone "find a port, then bind it" gap.
  PORT: z.coerce.number().int().min(0).default(8787),
  HOST: z.string().default('0.0.0.0'),

  /** Where the SQLite file lives, relative to the repository root. */
  DATABASE_PATH: z.string().default('data/trip-planner.db'),

  /**
   * The built client, relative to the repository root. When it is set this
   * server also serves the app, which is what deploying the two as one process
   * needs. Left unset in dev, where Vite serves the client and proxies here.
   */
  WEB_DIST: z.string().optional(),

  /** `fs` keeps attachments on disk; `s3` is configured in stage 5. */
  BLOB_STORE: z.enum(['fs', 's3']).default('fs'),
  BLOB_DIR: z.string().default('data/blobs'),

  /* Only read when BLOB_STORE is s3. */
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PREFIX: z.string().default('blobs'),

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
  webDist: parsed.data.WEB_DIST ? resolve(repoRoot, parsed.data.WEB_DIST) : undefined,
  isProduction: parsed.data.NODE_ENV === 'production',
} as const;
