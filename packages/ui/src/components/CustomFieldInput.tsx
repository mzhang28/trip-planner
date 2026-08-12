import type { CustomValue, FieldDef, OptionId } from '@trip/crdt';
import { valueMatchesType } from '@trip/crdt';
import { Checkbox, Label } from 'react-aria-components';
import { cn } from '../lib/cn';
import { coloredSurfaceStyle } from '../lib/color';
import { TextField } from './TextField';

export interface CustomFieldInputProps {
  def: FieldDef;
  value: CustomValue | undefined;
  onChange: (value: CustomValue | undefined) => void;
  isDisabled?: boolean;
}

const CONTROL = cn(
  'w-full rounded-md border border-line-input bg-card px-2.5 text-ink',
  'placeholder:text-ink-placeholder',
  'focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60',
);

/** `YYYY-MM-DD` for a date input, read in UTC so it round-trips unchanged. */
function toDateInput(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function toDateTimeInput(at: number): string {
  return new Date(at).toISOString().slice(0, 16);
}

/**
 * The right control for whatever a custom field holds.
 *
 * A value keeps its own kind, so a field retyped after values were entered
 * shows those values as needing attention instead of rendering a number as
 * though it were a date. Getting that wrong loses data quietly: the person sees
 * a plausible value, corrects it, and the original is gone.
 */
export function CustomFieldInput({ def, value, onChange, isDisabled }: CustomFieldInputProps) {
  if (value && !valueMatchesType(value, def)) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-secondary">{def.label}</span>
        <div className="rounded-md border border-pending bg-pending-soft px-2.5 py-2 text-xs text-pending-text">
          This was saved as a {value.kind} before the field became a {def.type}. Clear it to enter
          a new one.
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-2 font-medium underline underline-offset-2"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  switch (def.type) {
    case 'longtext':
      return (
        <TextField
          label={def.label}
          multiline
          isDisabled={isDisabled}
          value={value?.kind === 'text' ? value.text : ''}
          onChange={(text) => onChange(text ? { kind: 'text', text } : undefined)}
        />
      );

    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return (
        <TextField
          label={def.label}
          type={def.type === 'phone' ? 'tel' : def.type === 'text' ? 'text' : def.type}
          isDisabled={isDisabled}
          value={value?.kind === 'text' ? value.text : ''}
          onChange={(text) => onChange(text ? { kind: 'text', text } : undefined)}
        />
      );

    case 'number':
    case 'money':
      return (
        <TextField
          label={def.type === 'money' && def.currency ? `${def.label} (${def.currency})` : def.label}
          description={def.type === 'number' && def.unit ? `In ${def.unit}` : undefined}
          isDisabled={isDisabled}
          inputMode="decimal"
          value={value?.kind === 'number' ? String(value.number) : ''}
          onChange={(text) => {
            const parsed = Number(text);
            // An unfinished "12." or a stray letter clears nothing: the field
            // keeps what it had until the text is a number again.
            if (text === '') onChange(undefined);
            else if (!Number.isNaN(parsed)) onChange({ kind: 'number', number: parsed });
          }}
        />
      );

    case 'date':
    case 'datetime': {
      const asInput =
        value?.kind === 'instant'
          ? def.type === 'date'
            ? toDateInput(value.at)
            : toDateTimeInput(value.at)
          : '';

      return (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-secondary">{def.label}</span>
          <input
            type={def.type === 'date' ? 'date' : 'datetime-local'}
            disabled={isDisabled}
            value={asInput}
            onChange={(e) => {
              const parsed = Date.parse(
                def.type === 'date' ? `${e.target.value}T00:00:00Z` : `${e.target.value}:00Z`,
              );
              onChange(Number.isNaN(parsed) ? undefined : { kind: 'instant', at: parsed });
            }}
            className={cn(CONTROL, 'h-9')}
          />
        </label>
      );
    }

    case 'checkbox':
      return (
        <Checkbox
          isSelected={value?.kind === 'bool' ? value.bool : false}
          isDisabled={isDisabled}
          onChange={(bool) => onChange({ kind: 'bool', bool })}
          className="group flex cursor-pointer items-center gap-2 text-sm text-ink"
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex size-4 items-center justify-center rounded-sm border border-line-input',
              'group-data-selected:border-accent group-data-selected:bg-accent',
              'group-data-focus-visible:outline-focus group-data-focus-visible:outline-2 group-data-focus-visible:outline-offset-1',
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3 text-accent-ink" fill="none">
              <path
                d="M2.5 6.5 5 9l4.5-5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-0 group-data-selected:opacity-100"
              />
            </svg>
          </span>
          {def.label}
        </Checkbox>
      );

    case 'select':
    case 'multiselect': {
      const selected = value?.kind === 'options' ? value.selected : {};
      const options = Object.entries(def.options ?? {});

      function toggle(optionId: OptionId) {
        const next: Record<OptionId, true> = def.type === 'select' ? {} : { ...selected };

        if (selected[optionId]) delete next[optionId];
        else next[optionId] = true;

        onChange(Object.keys(next).length > 0 ? { kind: 'options', selected: next } : undefined);
      }

      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-ink-secondary">{def.label}</Label>
          {options.length === 0 ? (
            <p className="text-2xs text-ink-muted">
              No choices yet. Add some in the trip’s field settings.
            </p>
          ) : (
            <div
              role={def.type === 'select' ? 'radiogroup' : 'group'}
              aria-label={def.label}
              className="flex flex-wrap gap-1.5"
            >
              {options.map(([optionId, option]) => (
                <button
                  key={optionId}
                  type="button"
                  role={def.type === 'select' ? 'radio' : 'checkbox'}
                  aria-checked={Boolean(selected[optionId])}
                  disabled={isDisabled}
                  onClick={() => toggle(optionId)}
                  style={coloredSurfaceStyle(option.color)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                    'focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-1',
                    option.color
                      ? selected[optionId]
                        ? 'ring-2 ring-current ring-offset-1 ring-offset-card'
                        : 'hover:brightness-95'
                      : selected[optionId]
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : 'border-line-default text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {selected[optionId] && (
                    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none">
                      <path
                        d="M2.5 6.5 5 9l4.5-5.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
  }
}
