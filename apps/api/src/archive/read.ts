import { createHash } from 'node:crypto';
import { remapMentionIds, type TripDoc, type TripEvent, type TripFile } from '@trip/crdt';
import { unzipSync } from 'fflate';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  BLOB_HASH,
  FILES_PREFIX,
  MANIFEST_ENTRY,
  manifestSchema,
  type Manifest,
} from './manifest';

/** The same ceiling an upload has, applied to each file inside an archive. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Room for a very large trip's text. Nothing legitimate comes near it. */
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

/**
 * An archive this server will not read, and why.
 *
 * The code reaches the client so it can say something better than "import
 * failed" -- a damaged file, a file from a newer version, and a file that was
 * never an archive all call for different next steps.
 */
export class ArchiveError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ReadArchive {
  manifest: Manifest;
  /** Attachment bytes, keyed by the hash that is both name and checksum. */
  files: Map<string, Uint8Array>;
}

export function readArchive(bytes: Uint8Array): ReadArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      /*
       * Decides what to decompress by what the archive claims each entry
       * expands to, before any of it is expanded. Without a limit here a small
       * archive of highly compressible data expands to whatever it likes, and
       * the first thing that notices is the machine running out of memory.
       */
      filter: (file) => {
        if (file.name === MANIFEST_ENTRY) return file.originalSize <= MAX_MANIFEST_BYTES;
        if (!file.name.startsWith(FILES_PREFIX)) return false;
        if (!BLOB_HASH.test(file.name.slice(FILES_PREFIX.length))) return false;

        /*
         * An entry over the ceiling is skipped rather than refused, and the
         * import reports it among the attachments it could not restore. No
         * export this application writes can contain one, because an upload
         * that size is refused in the first place -- so the trip around it is
         * still worth having.
         */
        return file.originalSize <= MAX_FILE_BYTES;
      },
    });
  } catch (error) {
    throw new ArchiveError('not_a_zip', `This file is not a readable zip: ${String(error)}`);
  }

  const manifestBytes = entries[MANIFEST_ENTRY];
  if (!manifestBytes) {
    throw new ArchiveError('no_manifest', `The archive has no ${MANIFEST_ENTRY}.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    throw new ArchiveError('bad_manifest', `${MANIFEST_ENTRY} is not JSON: ${String(error)}`);
  }

  /*
   * Checked before the schema runs, so that an archive from a later version is
   * told apart from a damaged one. Both fail to parse, and only one of them is
   * worth telling somebody to upgrade over.
   */
  const envelope = json as { format?: unknown; version?: unknown };
  if (envelope.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError('bad_manifest', 'This is not a trip archive.');
  }
  if (typeof envelope.version === 'number' && envelope.version > ARCHIVE_VERSION) {
    throw new ArchiveError(
      'unsupported_version',
      `The archive is version ${envelope.version} and this server reads up to ${ARCHIVE_VERSION}.`,
    );
  }

  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new ArchiveError(
      'bad_manifest',
      parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  }

  const files = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(entries)) {
    if (name === MANIFEST_ENTRY) continue;

    /*
     * Every file is hashed and checked against the name it came under.
     *
     * Content addressing is the one promise the blob store makes: bytes read
     * back under a hash are the bytes that hash. Storing an entry without
     * checking would let a damaged or edited archive put anything under the
     * name of a document somebody else already has, and nothing downstream
     * looks again.
     */
    const hash = name.slice(FILES_PREFIX.length);
    const actual = createHash('sha256').update(content).digest('hex');

    if (actual !== hash) {
      throw new ArchiveError(
        'file_corrupt',
        `${name} does not contain the bytes it is named after.`,
      );
    }

    files.set(hash, content);
  }

  return { manifest: parsed.data, files };
}

/**
 * Removes references to attachments whose bytes nobody has.
 *
 * A document that points at bytes which are not there renders a file with a
 * download that fails, and there is no way back from it: the reference cannot
 * be repaired, only removed. Dropping it on the way in leaves a trip that is
 * whole, and returning what was dropped is what lets the import say which
 * attachments did not survive rather than losing them quietly.
 */
export function withoutUnavailableFiles(
  doc: TripDoc,
  available: ReadonlySet<string>,
): { doc: TripDoc; dropped: TripFile[] } {
  const dropped = new Map<string, TripFile>();

  const files: NonNullable<TripDoc['files']> = {};
  for (const [hash, file] of Object.entries(doc.files ?? {})) {
    if (available.has(hash)) files[hash] = file;
    else dropped.set(hash, file);
  }

  const events: TripDoc['events'] = {};
  for (const [eventId, event] of Object.entries(doc.events)) {
    const attachments: (typeof event)['attachments'] = {};

    for (const [id, attachment] of Object.entries(event.attachments)) {
      if (available.has(attachment.blobHash)) attachments[id] = attachment;
      else dropped.set(attachment.blobHash, attachment);
    }

    events[eventId] = { ...event, attachments };
  }

  return { doc: { ...doc, files, events }, dropped: [...dropped.values()] };
}

/**
 * Gives an imported trip its own event and link ids.
 *
 * An import is a copy, and two copies cannot share ids. The relational view
 * keys an event by its id alone rather than by the trip it belongs to, so
 * importing an archive back into the server that wrote it collides on the first
 * event. Fresh ids also keep the two apart everywhere else an id is the only
 * thing distinguishing them, which is what a copy should be.
 *
 * Attachment, todo and field ids are left as they were. Nothing outside the
 * document keys on them, and keeping them is what lets a `file` mention go on
 * pointing at the attachment it named.
 */
export function withFreshIds(doc: TripDoc, newId: (prefix: string) => string): TripDoc {
  const eventIds = new Map<string, string>();
  for (const id of Object.keys(doc.events)) eventIds.set(id, newId('e'));

  const events: TripDoc['events'] = {};

  for (const [was, event] of Object.entries(doc.events)) {
    const id = eventIds.get(was)!;

    const links: TripEvent['links'] = {};
    for (const link of Object.values(event.links)) links[newId('l')] = link;

    events[id] = {
      ...event,
      id,
      links,
      // A description can name other events, by id, in the middle of a
      // sentence. Renumbering the events without this leaves every mention
      // pointing at nothing, and the sentence reading as though it still works.
      ...(event.description === undefined
        ? {}
        : { description: remapMentionIds(event.description, eventIds) }),
    };
  }

  return { ...doc, events };
}
