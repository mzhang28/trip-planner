import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BlobStore } from './BlobStore';

/**
 * Attachments on the local disk, which is the default so the app runs with
 * nothing external configured.
 *
 * Files are spread across a directory per first byte of the hash. A single flat
 * directory with tens of thousands of entries is slow to list and slow to open
 * on most filesystems, and the two-character prefix costs nothing to compute.
 */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  #path(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  async has(hash: string): Promise<boolean> {
    try {
      await stat(this.#path(hash));
      return true;
    } catch {
      return false;
    }
  }

  async put(hash: string, bytes: Uint8Array, _mime: string): Promise<void> {
    const path = this.#path(hash);
    await mkdir(dirname(path), { recursive: true });

    // Written to a temporary name and moved into place, so a crash mid-write
    // cannot leave a file that has the right name and the wrong bytes.
    const temporary = `${path}.${process.pid}.partial`;
    await writeFile(temporary, bytes);
    await rm(path, { force: true });
    await (await import('node:fs/promises')).rename(temporary, path);
  }

  async get(hash: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(hash)));
    } catch {
      return null;
    }
  }

  async delete(hash: string): Promise<void> {
    await rm(this.#path(hash), { force: true });
  }
}
