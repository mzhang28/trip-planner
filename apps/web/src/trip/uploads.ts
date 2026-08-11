import { createStore, del, get, keys, set } from 'idb-keyval';
import { sha256Hex } from '../lib/crypto';

/*
 * Its own database, not another store inside the documents one.
 *
 * idb-keyval creates an object store only when it creates the database, so
 * adding a second store to a database that already exists on a device fails --
 * which is everyone who opened a trip before ever attaching a file.
 */
const store = createStore('trip-planner-uploads', 'uploads');

export interface QueuedUpload {
  hash: string;
  filename: string;
  mime: string;
  size: number;
  bytes: ArrayBuffer;
  queuedAt: number;
}

/** SHA-256 of the bytes, which is the name the file is stored under. */
export async function hashFile(file: File): Promise<{ hash: string; bytes: ArrayBuffer }> {
  const bytes = await file.arrayBuffer();
  return { hash: await sha256Hex(bytes), bytes };
}

/**
 * Holds a file until it can be sent.
 *
 * The reference goes into the document straight away and the bytes wait here,
 * so someone photographing a booking on a train sees the attachment on the
 * event immediately and everyone else sees it listed as not yet uploaded. The
 * alternative — refusing the attachment until there is a network — loses the
 * photograph, which is the thing that was hard to get.
 */
export async function queueUpload(upload: QueuedUpload): Promise<void> {
  await set(`upload:${upload.hash}`, upload, store);
}

export async function pendingUploads(): Promise<QueuedUpload[]> {
  const all = await keys(store);
  const uploads = await Promise.all(all.map((key) => get<QueuedUpload>(key as string, store)));
  return uploads.filter((upload): upload is QueuedUpload => Boolean(upload));
}

export async function forgetUpload(hash: string): Promise<void> {
  await del(`upload:${hash}`, store);
}

export interface FlushResult {
  sent: number;
  remaining: number;
}

/**
 * Sends whatever is waiting.
 *
 * A blob already on the server is dropped from the queue without being sent
 * again: the name is the content, so the server having it means it is the same
 * file. Anything that fails stays queued for the next attempt.
 */
export async function flushUploads(): Promise<FlushResult> {
  const queued = await pendingUploads();
  let sent = 0;

  for (const upload of queued) {
    try {
      const head = await fetch(`/api/blobs/${upload.hash}`, { method: 'HEAD' });
      if (head.ok) {
        await forgetUpload(upload.hash);
        sent += 1;
        continue;
      }

      const response = await fetch(`/api/blobs/${upload.hash}`, {
        method: 'PUT',
        headers: { 'content-type': upload.mime },
        body: upload.bytes,
      });

      if (response.ok) {
        await forgetUpload(upload.hash);
        sent += 1;
      }
    } catch {
      // No network. Leave it queued rather than dropping the bytes.
    }
  }

  return { sent, remaining: queued.length - sent };
}

/** Whether these bytes still need sending, for showing an attachment as pending. */
export async function isPending(hash: string): Promise<boolean> {
  return (await get<QueuedUpload>(`upload:${hash}`, store)) !== undefined;
}
