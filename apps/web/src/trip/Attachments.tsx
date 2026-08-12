import { tripFiles, type EventAttachment, type TripDoc, type TripEvent } from '@trip/crdt';
import { Button, cn } from '@trip/ui';
import { FilePlus2, Loader2, Paperclip, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { randomId } from '../lib/crypto';
import { FileDropZone, readableFileSize } from './FileDropZone';
import { flushUploads, isPending, subscribeUploadQueue } from './uploads';

export interface AttachmentsProps {
  event: TripEvent;
  doc: TripDoc | undefined;
  onAdd: (id: string, attachment: EventAttachment) => void;
  onRemove: (id: string) => void;
}

export function Attachments({ event, doc, onAdd, onRemove }: AttachmentsProps) {
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const attachments = Object.entries(event.attachments);
  const attachedHashes = new Set(attachments.map(([, file]) => file.blobHash));
  const reusable = tripFiles(doc)
    .filter((file) => !attachedHashes.has(file.blobHash))
    .filter((file) => file.filename.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.addedAt - a.addedAt);

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      if (!popup.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    let live = true;

    const refresh = () => {
      void Promise.all(
        attachments.map(async ([, attachment]) =>
          (await isPending(attachment.blobHash)) ? attachment.blobHash : null,
        ),
      ).then((hashes) => {
        if (live) setPending(new Set(hashes.filter((hash): hash is string => hash !== null)));
      });
    };

    refresh();
    const unsubscribe = subscribeUploadQueue(refresh);

    return () => {
      live = false;
      unsubscribe();
    };
  }, [event.attachments]);

  async function retry() {
    setBusy(true);
    setError(null);

    try {
      const { remaining } = await flushUploads();
      if (remaining === 0) setPending(new Set());
      else setError('Still waiting. The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  function attach(file: EventAttachment) {
    onAdd(`a_${randomId()}`, file);
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-secondary">Files</span>
        <div ref={popup} className="relative">
          <Button
            size="sm"
            data-testid="open-file-picker"
            aria-expanded={open}
            aria-haspopup="dialog"
            onPress={() => setOpen((value) => !value)}
          >
            <FilePlus2 aria-hidden="true" className="size-3.5" />
            Add file
          </Button>

          <div
            role="dialog"
            aria-label="Add a file"
            hidden={!open}
            className={cn(
              'absolute top-full right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg',
              'border border-line-default bg-raised p-3 shadow-lg',
            )}
          >
            <p className="mb-3 text-sm font-medium text-ink">Upload a new file</p>
            <FileDropZone
              compact
              inputTestId="attachment-input"
              dropTestId="attachment-drop"
              onUploaded={(file) => {
                attach(file);
              }}
            />

            <div className="my-3 flex items-center gap-2 text-2xs text-ink-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
              or reuse from this trip
            </div>

            {tripFiles(doc).filter((file) => !attachedHashes.has(file.blobHash)).length > 0 ? (
              <>
                <label className="mb-2 flex h-8 items-center gap-2 rounded-md border border-line-input bg-card px-2">
                  <Search aria-hidden="true" className="size-3.5 text-ink-muted" />
                  <span className="sr-only">Find a file</span>
                  <input
                    type="search"
                    placeholder="Find a file"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
                  />
                </label>
                <ul className="max-h-44 overflow-y-auto">
                  {reusable.map((file) => (
                    <li key={file.blobHash}>
                      <button
                        type="button"
                        onClick={() => {
                          attach(file);
                          setOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2 focus-visible:-outline-offset-1"
                      >
                        <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">
                          {file.filename}
                        </span>
                        <span className="shrink-0 text-2xs text-ink-muted">
                          {readableFileSize(file.size)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {reusable.length === 0 && (
                    <li className="px-2 py-3 text-center text-xs text-ink-muted">No files match.</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="py-2 text-center text-xs text-ink-muted">
                No other files in this trip yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {attachments.map(([id, attachment]) => (
            <li key={id} className="flex items-center gap-2">
              <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
              <a
                href={`/api/blobs/${attachment.blobHash}?mime=${encodeURIComponent(attachment.mime)}`}
                download={attachment.filename}
                className="min-w-0 flex-1 truncate text-xs text-accent-text underline underline-offset-2"
              >
                {attachment.filename}
              </a>
              <span className="shrink-0 text-2xs text-ink-muted">
                {readableFileSize(attachment.size)}
              </span>
              {pending.has(attachment.blobHash) && (
                <>
                  <span
                    className="shrink-0 rounded-sm bg-pending-soft px-1.5 py-0.5 text-2xs text-pending-text"
                    title="On this device. It will upload when there is a connection."
                  >
                    Waiting to send
                  </span>
                  <button
                    type="button"
                    data-testid="retry-upload"
                    onClick={() => void retry()}
                    className="shrink-0 text-2xs text-accent-text underline underline-offset-2"
                  >
                    {busy ? <Loader2 aria-label="Sending" className="size-3 animate-spin" /> : 'Send now'}
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={`Remove ${attachment.filename}`}
                onClick={() => onRemove(id)}
                className="shrink-0 text-ink-muted hover:text-danger focus-visible:outline-focus focus-visible:outline-2"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachments.length === 0 && <p className="text-xs text-ink-muted">No files attached.</p>}

      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** Sends anything still waiting whenever the network comes back. */
export function useUploadFlush(): void {
  useEffect(() => {
    const flush = () => void flushUploads();

    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);
}
