import { tripFiles, type TripDoc, type TripEvent } from '@trip/crdt';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { BlobStore } from '../blobs/BlobStore';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  FILES_PREFIX,
  MANIFEST_ENTRY,
  type Manifest,
} from './manifest';

/** Turns Automerge proxies into ordinary objects, and drops undefined with them. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The trip as it stands, without the bookkeeping a replica needs.
 *
 * Tombstones go: an event someone deleted is deleted, and a marker that exists
 * so an offline peer learns about the delete means nothing to a document with
 * no peers. Values belonging to a deleted field go with the field, because a
 * value whose definition is gone renders as nothing and cannot be edited back.
 *
 * Every hash the result points at has an entry in `files`, which is what lets
 * the writer below treat that one map as the list of bytes to pack.
 */
export function exportableDoc(doc: TripDoc): TripDoc {
  const source = plain(doc);

  const fieldDefs: TripDoc['fieldDefs'] = {};
  for (const [id, def] of Object.entries(source.fieldDefs ?? {})) {
    if (def.deletedAt === undefined) fieldDefs[id] = def;
  }

  const events: TripDoc['events'] = {};
  for (const [id, event] of Object.entries(source.events ?? {})) {
    if (event.deletedAt !== undefined) continue;

    const customFields: TripEvent['customFields'] = {};
    for (const [fieldId, value] of Object.entries(event.customFields ?? {})) {
      if (fieldId in fieldDefs) customFields[fieldId] = value;
    }

    events[id] = {
      ...event,
      links: event.links ?? {},
      attachments: event.attachments ?? {},
      customFields,
    };
  }

  const kept: TripDoc = { meta: source.meta, fieldDefs, events };
  if (source.cityColors) kept.cityColors = source.cityColors;

  /*
   * Read from the whole document, tombstones included, because that is what the
   * trip's Files page lists. Deleting an event takes the attachment off the
   * event and leaves the file in the trip, so a file whose only event is gone
   * is still a file somebody can see and download -- and an export that decided
   * otherwise would quietly drop it.
   *
   * `tripFiles` also discovers attachments that never reached the library,
   * which is every attachment on a document written before the library existed.
   */
  kept.files = Object.fromEntries(tripFiles(source).map((file) => [file.blobHash, file]));

  return kept;
}

/**
 * Produces the archive a chunk at a time.
 *
 * Streamed rather than assembled, so a trip with a hundred scans in it holds
 * one of them in memory at a time instead of all of them plus the zip.
 */
async function* archiveChunks(doc: TripDoc, blobs: BlobStore, exportedAt: number) {
  const exported = exportableDoc(doc);

  /*
   * Asked for before anything is written, because the manifest says which
   * attachments are missing and it is the first thing in the archive. Bytes
   * can go missing legitimately -- a sweep removes a blob once nothing points
   * at it, and a document restored from an older snapshot can point at one
   * again -- so an export that stops dead over a lost scan would refuse to
   * back up the one trip most in need of it.
   */
  const present: string[] = [];
  const missingFiles: string[] = [];
  for (const hash of Object.keys(exported.files ?? {})) {
    if (await blobs.has(hash)) present.push(hash);
    else missingFiles.push(hash);
  }

  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt,
    doc: exported,
    missingFiles,
  };

  const pending: Uint8Array[] = [];
  let failure: Error | null = null;

  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else pending.push(chunk);
  });

  /** Hands back whatever fflate produced during the last push. */
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (pending.length > 0) yield pending.shift()!;
  }

  // The manifest is the only entry worth compressing. Attachments are scans,
  // photographs and PDFs, which are already compressed -- deflating them again
  // costs time and gives back nothing.
  const entry = new ZipDeflate(MANIFEST_ENTRY, { level: 6 });
  zip.add(entry);
  entry.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
  yield* drain();

  for (const hash of present) {
    const bytes = await blobs.get(hash);
    // Gone between being counted and being read. The manifest already says it
    // is here, and the import drops a reference it has no bytes for, so the
    // archive is still readable -- one attachment short, and it says so.
    if (!bytes) continue;

    const file = new ZipPassThrough(`${FILES_PREFIX}${hash}`);
    zip.add(file);
    file.push(bytes, true);
    yield* drain();
  }

  zip.end();
  yield* drain();
}

/** Backpressure: fflate is only asked for more once the last chunk has gone. */
function streamOf(chunks: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      void iterator.return?.(reason);
    },
  });
}

export function archiveStream(
  doc: TripDoc,
  blobs: BlobStore,
  exportedAt = Date.now(),
): ReadableStream<Uint8Array> {
  return streamOf(archiveChunks(doc, blobs, exportedAt));
}

/** Collects the whole archive in memory. For tests and small trips. */
export async function archiveBytes(
  doc: TripDoc,
  blobs: BlobStore,
  exportedAt = Date.now(),
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of archiveChunks(doc, blobs, exportedAt)) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }

  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }

  return all;
}

/**
 * What the download is called: the trip's own name, and the day it was taken.
 *
 * Dated so that a month of backups sorts, and so taking one twice in a week
 * does not quietly overwrite the earlier one. Only the characters a filesystem
 * or a shell would take badly are removed -- a trip named 日本 keeps its name,
 * because reducing it to "trip" makes every export of every Japanese trip the
 * same file.
 *
 * Cut by code point rather than by string index, so a long name is never left
 * ending in half a character. Half a surrogate pair is not text, and encoding
 * one for the header below throws.
 */
export function archiveFilename(tripName: string, exportedAt = Date.now()): string {
  const cleaned = tripName
    // Control characters, path separators, and what Windows refuses in a name.
    .replace(/[\p{C}/\\:*?"<>|]/gu, ' ')
    .replace(/\s+/g, '-');

  const name = Array.from(cleaned)
    .slice(0, 60)
    .join('')
    // A leading dot would make it a hidden file rather than a named one.
    .replace(/^[-.]+|-+$/g, '');

  const day = new Date(exportedAt).toISOString().slice(0, 10);

  return `${name || 'trip'}-${day}.zip`;
}

/**
 * Names the download twice, which is what the header needs.
 *
 * `filename` has to be ASCII, so a name outside it survives only in the encoded
 * form. Browsers prefer the encoded form and everything else falls back to the
 * plain one, so both are sent and neither is guessed at.
 */
export function contentDisposition(tripName: string, exportedAt = Date.now()): string {
  const ascii = archiveFilename(tripName.replace(/[^\x20-\x7e]/g, ' '), exportedAt);
  const full = archiveFilename(tripName, exportedAt);

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}
