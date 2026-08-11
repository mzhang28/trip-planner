import { config } from '../config';
import type { BlobStore } from './BlobStore';
import { FsBlobStore } from './FsBlobStore';

export type { BlobInfo, BlobStore } from './BlobStore';
export { FsBlobStore } from './FsBlobStore';

/**
 * Picks a store from the environment.
 *
 * The S3 client is imported only when it is going to be used, so a deployment
 * keeping files on disk does not load the AWS SDK it will never call.
 */
export async function createBlobStore(): Promise<BlobStore> {
  if (config.BLOB_STORE === 'fs') return new FsBlobStore(config.blobDir);

  const missing = (['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter(
    (name) => !config[name],
  );

  if (missing.length > 0) {
    throw new Error(`BLOB_STORE=s3 needs ${missing.join(', ')}`);
  }

  const { S3BlobStore } = await import('./S3BlobStore');

  return new S3BlobStore({
    bucket: config.S3_BUCKET!,
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    accessKeyId: config.S3_ACCESS_KEY_ID!,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    prefix: config.S3_PREFIX,
  });
}
