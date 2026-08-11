import { cn } from '@trip/ui';
import { useEffect, useId, useState } from 'react';

export interface CheckedFieldProps {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  disabled?: boolean;
  /** Offered as you type, and still typeable if none of them fit. */
  suggestions?: string[];
  /** Returns a message when the text cannot be used, or null when it was taken. */
  onCommit: (value: string) => string | null;
}

/**
 * A text field that says so when it cannot use what was typed.
 *
 * Times, durations, and time zones were all free text that ignored anything
 * unparseable, so a mistyped hour or a negative duration looked accepted while
 * the event kept its old value. Keeping the text on screen and saying what is
 * wrong with it is the difference between a correction and a silent loss.
 */
export function CheckedField({
  label,
  value,
  hint,
  placeholder,
  inputMode,
  disabled,
  suggestions,
  onCommit,
}: CheckedFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Follows the value when it changes underneath, which happens when somebody
  // else edits the event or when a drag moves it.
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
        placeholder={placeholder}
        inputMode={inputMode}
        list={suggestions ? `${id}-suggestions` : undefined}
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

      {suggestions && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}

      <span id={`${id}-hint`} className={cn('text-2xs', error ? 'text-danger' : 'text-ink-muted')}>
        {error ?? hint}
      </span>
    </div>
  );
}
