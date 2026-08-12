import type { TripFile } from '@trip/crdt';
import { cn } from '@trip/ui';
import { Loader2, UploadCloud } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { flushUploads, hashFile, queueUpload } from './uploads';

/** Matches the API limit so a large file is refused before any upload starts. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function readableFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropZone({
  onUploaded,
  disabled = false,
  compact = false,
  inputTestId = 'file-upload-input',
  dropTestId = 'file-upload-drop',
}: {
  onUploaded: (file: TripFile) => void;
  disabled?: boolean;
  compact?: boolean;
  inputTestId?: string;
  dropTestId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length || disabled) return;

    setBusy(true);
    setError(null);

    try {
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name} is ${readableFileSize(file.size)}. The limit is 25 MB.`);
          continue;
        }

        const { hash, bytes } = await hashFile(file);
        const saved: TripFile = {
          blobHash: hash,
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          addedAt: Date.now(),
        };

        // Metadata can sync immediately while the bytes remain safely queued
        // on this device until the configured blob store can be reached.
        await queueUpload({
          hash,
          filename: saved.filename,
          mime: saved.mime,
          size: saved.size,
          bytes,
          queuedAt: saved.addedAt,
        });
        onUploaded(saved);
      }

      await flushUploads();
    } catch {
      setError('This file could not be read. Try it again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <div
        data-testid={dropTestId}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void add(event.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed text-center transition-colors',
          compact ? 'min-h-28 gap-1.5 px-4 py-3' : 'min-h-40 gap-2 px-6 py-5',
          over ? 'border-accent bg-accent-soft' : 'border-line-default bg-sunken/40',
          disabled && 'cursor-not-allowed opacity-55',
        )}
      >
        <UploadCloud aria-hidden="true" className="size-5 text-ink-muted" />
        <p className="text-xs text-ink-secondary">
          Drop {compact ? 'a file' : 'files'} here or{' '}
          <label
            htmlFor={inputId}
            className={cn(
              'font-medium text-accent-text underline underline-offset-2',
              disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            choose {compact ? 'one' : 'files'}
          </label>
        </p>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          disabled={disabled}
          data-testid={inputTestId}
          onChange={(event) => void add(event.currentTarget.files)}
          className="sr-only"
        />
        <span className="text-2xs text-ink-muted">Up to 25 MB each</span>
        {busy && (
          <span className="flex items-center gap-1 text-2xs text-ink-muted">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            Adding
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
