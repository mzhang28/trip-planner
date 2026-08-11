import { cn } from '@trip/ui';
import { useEffect, useId, useState } from 'react';

export interface TimeFieldProps {
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
  /** Returns a message when the text cannot be used, or null when it was taken. */
  onCommit: (value: string) => string | null;
}

/**
 * A time that says so when it cannot read what was typed.
 *
 * The old field ignored anything it could not parse, so a mistyped hour looked
 * accepted and the event kept its old time. Keeping the text and saying what is
 * wrong is the difference between a correction and a silent loss.
 */
export function TimeField({ label, value, hint, disabled, onCommit }: TimeFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Follows the event when it changes underneath, which happens when somebody
  // else edits it or when a drag moves it.
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-secondary">
        {label}
      </label>

      <input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder="09:00"
        inputMode="numeric"
        aria-invalid={error !== null}
        aria-describedby={`${id}-hint`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setError(onCommit(draft.trim()))}
        className={cn(
          'h-9 w-full rounded-md border bg-card px-2.5 text-ink',
          'placeholder:text-ink-placeholder',
          'focus:outline-focus focus:outline-2 focus:-outline-offset-1',
          'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60',
          error ? 'border-danger' : 'border-line-input focus:border-accent',
        )}
      />

      <span id={`${id}-hint`} className={cn('text-2xs', error ? 'text-danger' : 'text-ink-muted')}>
        {error ?? hint}
      </span>
    </div>
  );
}
