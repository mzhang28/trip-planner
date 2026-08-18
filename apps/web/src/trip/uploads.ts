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
const listeners = new Set<() => void>();

function publishQueueChange(): void {
  for (const listener of listeners) listener();
}

/** Lets file rows update immediately when a queued upload is sent or retried. */
export function subscribeUploadQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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
  publishQueueChange();
}

export async function pendingUploads(): Promise<QueuedUpload[]> {
  const all = await keys(store);
  const uploads = await Promise.all(all.map((key) => get<QueuedUpload>(key as string, store)));
  return uploads.filter((upload): upload is QueuedUpload => Boolean(upload));
}

export async function forgetUpload(hash: string): Promise<void> {
  await del(`upload:${hash}`, store);
  publishQueueChange();
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
let flushing: Promise<FlushResult> | null = null;

export function flushUploads(): Promise<FlushResult> {
  // One at a time. Attaching a file flushes, and so does coming back online, so
  // two passes can otherwise send the same bytes twice.
  flushing ??= runFlush().finally(() => {
    flushing = null;
  });

  return flushing;
}

async function runFlush(): Promise<FlushResult> {
  const queued = await pendingUploads();
  let sent = 0;

  for (const upload of queued) {
    try {
      /*
       * The server says where these bytes should go. On object storage that is
       * a presigned URL and the upload never touches the API; otherwise it is
       * the API itself. Asking also settles whether the bytes are already
       * there, which they often are -- the name is the content.
       */
      const ask = await fetch(
        `/api/blobs/${upload.hash}/upload-url?mime=${encodeURIComponent(upload.mime)}`,
        { method: 'POST' },
      );

      if (!ask.ok) continue;

      const plan = (await ask.json()) as
        { alreadyStored: true } | { method: 'PUT'; url: string; direct: boolean };

      if ('alreadyStored' in plan) {
        await forgetUpload(upload.hash);
        sent += 1;
        continue;
      }

      const response = await fetch(plan.url, {
        method: plan.method,
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
