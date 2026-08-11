import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BlobStore } from './BlobStore';

export interface S3Options {
  bucket: string;
  region: string;
  /**
   * Set for anything that speaks S3 without being S3 — R2, MinIO, B2. Left
   * unset for AWS itself, where the SDK works the endpoint out from the region.
   */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
}

/**
 * Attachments in object storage.
 *
 * Presigning is the point of using it: the browser uploads straight to the
 * bucket, so a large file never travels through this server and never occupies
 * a request slot for the minute it takes to arrive.
 */
export class S3BlobStore implements BlobStore {
  readonly #client: S3Client;

  constructor(private readonly options: S3Options) {
    this.#client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      // Anything other than AWS needs the bucket in the path rather than in the
      // hostname, since those endpoints have no per-bucket subdomain.
      forcePathStyle: Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  #key(hash: string): string {
    return `${this.options.prefix ?? 'blobs'}/${hash.slice(0, 2)}/${hash}`;
  }

  async has(hash: string): Promise<boolean> {
    try {
      await this.#client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: this.#key(hash) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async put(hash: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.#key(hash),
        Body: bytes,
        ContentType: mime,
      }),
    );
  }

  async get(hash: string): Promise<Uint8Array | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: this.#key(hash) }),
      );
      const bytes = await response.Body?.transformToByteArray();
      return bytes ?? null;
    } catch {
      return null;
    }
  }

  async delete(hash: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.#key(hash) }),
    );
  }

  async presignPut(hash: string, mime: string): Promise<string> {
    return getSignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.#key(hash),
        ContentType: mime,
      }),
      { expiresIn: 900 },
    );
  }

  async presignGet(hash: string): Promise<string> {
    return getSignedUrl(
      this.#client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: this.#key(hash) }),
      { expiresIn: 3600 },
    );
  }
}
