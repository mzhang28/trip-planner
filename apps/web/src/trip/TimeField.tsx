import { cn } from '@trip/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { TimezonePicker } from './TimezonePicker';

export interface TimeFieldProps {
  label: string;
  /** Short derived information shown on the same line as the label. */
  labelDetail?: ReactNode;
  value: string;
  hint?: string;
  disabled?: boolean;
  timezone?: string;
  timezoneAt?: number;
  timezoneLabel?: string;
  onTimezoneChange?: (timezone: string) => void;
  onCommit: (value: string) => string | null;
}

/** A checked time of day with its time zone attached to the same control. */
export function TimeField({
  label,
  labelDetail,
  value,
  hint,
  disabled,
  timezone,
  timezoneAt,
  timezoneLabel = 'Time zone',
  onTimezoneChange,
  onCommit,
}: TimeFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-ink-secondary">
          {label}
        </label>
        {labelDetail && <span className="text-2xs text-ink-muted">{labelDetail}</span>}
      </div>

      <div
        className={cn(
          'flex h-9 items-center rounded-md border bg-card pr-1 pl-2.5',
          'focus-within:border-accent focus-within:outline-focus focus-within:outline-2 focus-within:-outline-offset-1',
          disabled && 'bg-sunken opacity-60',
          error ? 'border-danger' : 'border-line-input',
        )}
      >
        <input
          id={id}
          value={draft}
          disabled={disabled}
          placeholder="09:00"
          inputMode="numeric"
          aria-invalid={error !== null}
          aria-describedby={error || hint ? `${id}-hint` : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setError(onCommit(draft.trim()))}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-ink-placeholder disabled:cursor-not-allowed"
        />

        {timezone && onTimezoneChange && (
          <TimezonePicker
            value={timezone}
            at={timezoneAt}
            label={timezoneLabel}
            onChange={onTimezoneChange}
          />
        )}
      </div>

      {(error || hint) && (
        <span id={`${id}-hint`} className={cn('text-2xs', error ? 'text-danger' : 'text-ink-muted')}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
