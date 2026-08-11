import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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

    /*
     * Written to a temporary name and moved into place, so a crash mid-write
     * cannot leave a file with the right name and the wrong bytes.
     *
     * The temporary name is unique per write, not per process. Two uploads of
     * the same file arriving together would otherwise pick the same name, and
     * whichever renamed second would find its own file already moved away.
     */
    const temporary = `${path}.${randomBytes(8).toString('hex')}.partial`;
    await writeFile(temporary, bytes);

    // Renaming over an existing file is atomic, so there is no window where the
    // name exists with nothing behind it.
    await rename(temporary, path);
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

  async list(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const hashes: string[] = [];

    let prefixes: string[];
    try {
      prefixes = await readdir(this.root);
    } catch {
      // Nothing has been stored yet, so there is nothing to collect.
      return [];
    }

    for (const prefix of prefixes) {
      try {
        for (const name of await readdir(join(this.root, prefix))) {
          // Skip a partial write from a crash: it has no reference either way.
          if (!name.endsWith('.partial')) hashes.push(name);
        }
      } catch {
        // A file where a directory was expected. Not ours.
      }
    }

    return hashes;
  }
}
