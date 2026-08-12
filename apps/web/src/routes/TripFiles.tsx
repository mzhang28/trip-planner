import { addTripFile, tripFiles, type TripDoc, type TripFile } from '@trip/crdt';
import { Card, ThemeToggle } from '@trip/ui';
import { File as FileIcon, FilePlus2, Paperclip } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type TripSummary } from '../lib/api';
import { FileDropZone, readableFileSize } from '../trip/FileDropZone';
import { SyncBadge } from '../trip/SyncBadge';
import { TripChrome } from '../trip/TripChrome';
import { useUploadFlush } from '../trip/Attachments';
import { isPending, subscribeUploadQueue } from '../trip/uploads';
import { useTripState, useTripStore } from '../trip/useTrip';

function FileRow({
  file,
  eventNames,
}: {
  file: TripFile;
  eventNames: string[];
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void isPending(file.blobHash).then((value) => {
        if (live) setPending(value);
      });
    };
    refresh();
    const unsubscribe = subscribeUploadQueue(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [file.blobHash]);

  return (
    <li>
      <Card className="flex items-center gap-3 p-3 sm:p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken text-ink-muted">
          <FileIcon aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={`/api/blobs/${file.blobHash}?mime=${encodeURIComponent(file.mime)}`}
            download={file.filename}
            className="block truncate text-sm font-medium text-accent-text hover:underline"
          >
            {file.filename}
          </a>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-muted">
            <span>{readableFileSize(file.size)}</span>
            <span aria-hidden="true">·</span>
            <span>{file.mime}</span>
            {pending && (
              <span className="rounded-sm bg-pending-soft px-1.5 py-0.5 text-pending-text">
                Waiting to send
              </span>
            )}
          </div>
        </div>
        <div className="hidden max-w-64 text-right sm:block">
          {eventNames.length > 0 ? (
            <p className="truncate text-xs text-ink-secondary" title={eventNames.join(', ')}>
              <Paperclip aria-hidden="true" className="mr-1 inline size-3" />
              {eventNames.length === 1 ? eventNames[0] : `${eventNames.length} events`}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">Not attached yet</p>
          )}
        </div>
      </Card>
    </li>
  );
}

export function TripFiles() {
  const { tripId } = useParams<{ tripId: string }>();
  const store = useTripStore(tripId);
  const state = useTripState(store);
  const doc = state?.doc as TripDoc | undefined;
  const [trip, setTrip] = useState<TripSummary | null>(null);

  const load = useCallback(() => {
    if (!tripId) return;
    void api
      .getTrip(tripId)
      .then(setTrip)
      .catch(() => setTrip(null));
  }, [tripId]);

  useEffect(load, [load]);
  useUploadFlush();

  const files = useMemo(
    () => tripFiles(doc).sort((a, b) => b.addedAt - a.addedAt),
    [doc],
  );

  const usage = useMemo(() => {
    const byHash = new Map<string, Map<string, string>>();

    for (const event of Object.values(doc?.events ?? {})) {
      if (event.deletedAt !== undefined) continue;
      for (const attachment of Object.values(event.attachments ?? {})) {
        const events = byHash.get(attachment.blobHash) ?? new Map<string, string>();
        events.set(event.id, event.name || 'Unnamed event');
        byHash.set(attachment.blobHash, events);
      }
    }

    return byHash;
  }, [doc]);

  const readOnly = trip === null || trip.role === 'viewer';

  return (
    <TripChrome tripId={tripId ?? ''} tripName={trip?.name ?? doc?.meta?.name ?? 'Trip'}>
      <header className="shrink-0 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to={`/t/${tripId}`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
          >
            Back to trip
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg">Files</h1>
          <Link
            to={`/t/${tripId}/todos`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
          >
            To-dos
          </Link>
          <Link
            to={`/t/${tripId}/fields`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
          >
            Settings
          </Link>
          <SyncBadge state={state} />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h2 className="mb-1 text-base text-ink">Trip files</h2>
          <p className="max-w-prose text-sm text-ink-secondary">
            Upload a file once, then attach it to any number of events from each event’s file menu.
          </p>
        </div>

        {!readOnly ? (
          <div className="mb-8">
            <FileDropZone
              onUploaded={(file) =>
                store?.change((current) => addTripFile(current, file))
              }
            />
          </div>
        ) : trip?.role === 'viewer' ? (
          <p className="mb-6 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-secondary">
            You can download this trip’s files. Only an editor can upload new ones.
          </p>
        ) : null}

        {files.length > 0 ? (
          <ul className="flex flex-col gap-2" data-testid="trip-files">
            {files.map((file) => (
              <FileRow
                key={file.blobHash}
                file={file}
                eventNames={[...(usage.get(file.blobHash)?.values() ?? [])]}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-line bg-card px-6 py-12 text-center">
            <FilePlus2 aria-hidden="true" className="mx-auto mb-3 size-7 text-ink-muted" />
            <h2 className="text-sm text-ink">No files yet</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Upload travel documents, tickets, confirmations, or anything else the trip needs.
            </p>
          </div>
        )}
      </main>
    </TripChrome>
  );
}
