import type { EventAttachment, TripEvent } from '@trip/crdt';
import { cn } from '@trip/ui';
import { Loader2, Paperclip, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { randomId } from '../lib/crypto';
import { flushUploads, hashFile, isPending, queueUpload } from './uploads';

/** Matches the server's own ceiling, so a refusal is explained before the upload. */
const MAX_BYTES = 25 * 1024 * 1024;

export interface AttachmentsProps {
  event: TripEvent;
  onAdd: (id: string, attachment: EventAttachment) => void;
  onRemove: (id: string) => void;
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Attachments({ event, onAdd, onRemove }: AttachmentsProps) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const attachments = Object.entries(event.attachments);

  // Which of these are still waiting to be sent, so they can say so.
  useEffect(() => {
    let live = true;

    void Promise.all(
      attachments.map(async ([, attachment]) =>
        (await isPending(attachment.blobHash)) ? attachment.blobHash : null,
      ),
    ).then((hashes) => {
      if (live) setPending(new Set(hashes.filter((hash): hash is string => hash !== null)));
    });

    return () => {
      live = false;
    };
  }, [event.attachments]);

  async function attach(files: FileList | null) {
    if (!files?.length) return;

    setBusy(true);
    setError(null);

    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is ${readableSize(file.size)}. The limit is 25 MB.`);
          continue;
        }

        const { hash, bytes } = await hashFile(file);

        /*
         * Queued before the reference goes in, and the reference goes in
         * whether or not the send works. Someone photographing a booking on a
         * train keeps the photograph; the bytes catch up when there is signal.
         */
        await queueUpload({
          hash,
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          bytes,
          queuedAt: Date.now(),
        });

        onAdd(`a_${randomId()}`, {
          blobHash: hash,
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          addedAt: Date.now(),
        });
      }

      const { remaining } = await flushUploads();
      if (remaining === 0) setPending(new Set());
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs font-medium text-ink-secondary">Files</span>

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

              <span className="tabular shrink-0 text-2xs text-ink-muted">
                {readableSize(attachment.size)}
              </span>

              {pending.has(attachment.blobHash) && (
                <span
                  className="shrink-0 rounded-sm bg-pending-soft px-1.5 py-0.5 text-2xs text-pending-text"
                  title="On this device. It will upload when there is a connection."
                >
                  Not sent yet
                </span>
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

      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Attach files to {event.name}
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          data-testid="attachment-input"
          onChange={(e) => void attach(e.target.files)}
          className={cn(
            'text-xs text-ink-muted',
            'file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-line-default',
            'file:bg-card file:px-2 file:py-1 file:text-xs file:text-ink hover:file:bg-sunken',
          )}
        />

        {busy && (
          <span className="flex items-center gap-1 text-2xs text-ink-muted">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            Adding
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Sends anything still waiting whenever the network comes back.
 *
 * Mounted once beside the trip rather than per event, so a queue built up
 * across several events drains in one pass.
 */
export function useUploadFlush(): void {
  useEffect(() => {
    const flush = () => void flushUploads();

    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);
}
