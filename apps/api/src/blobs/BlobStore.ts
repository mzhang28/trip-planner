export interface BlobInfo {
  hash: string;
  size: number;
  mime: string;
}

/**
 * Where attachment bytes live.
 *
 * Content-addressed: the key is the SHA-256 of the bytes, so the same file
 * attached to three events is stored once and an upload that arrives twice is
 * free. It also means a blob can never be the wrong bytes for its name.
 *
 * The interface exists so a deployment can keep files on disk or in object
 * storage without anything above this line knowing which.
 */
export interface BlobStore {
  has(hash: string): Promise<boolean>;
  put(hash: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(hash: string): Promise<Uint8Array | null>;
  delete(hash: string): Promise<void>;

  /**
   * A URL the browser can upload to directly, when the backing store offers
   * one. Absent for the filesystem store, where the upload goes through the
   * API because there is nowhere else for it to go.
   */
  presignPut?(hash: string, mime: string): Promise<string>;
  presignGet?(hash: string): Promise<string>;
}
