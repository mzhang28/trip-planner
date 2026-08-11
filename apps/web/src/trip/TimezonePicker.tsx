import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { cn } from '@trip/ui';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { knownTimeZones, timeZoneAbbreviation } from '../lib/time';

interface ZoneOption {
  id: string;
  abbreviation: string;
  offset: string;
}

export interface TimezonePickerProps {
  value: string;
  /** Abbreviations and daylight-saving offsets are relative to this instant. */
  at?: number;
  label: string;
  disabled?: boolean;
  onChange: (timezone: string) => void;
}

/**
 * The small zone control attached to a time.
 *
 * A short abbreviation keeps the resting time field compact. The full IANA
 * identifier is one click away, where it can be searched by either name or
 * the abbreviation printed on a ticket or confirmation email.
 */
export function TimezonePicker({
  value,
  at = Date.now(),
  label,
  disabled,
  onChange,
}: TimezonePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(next) {
      setOpen(next);
      if (!next) setQuery('');
    },
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(180, availableHeight)}px`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const options = useMemo<ZoneOption[]>(() => {
    const zones = knownTimeZones();
    const withCurrent = zones.includes(value) ? zones : [value, ...zones];

    return withCurrent.map((id) => ({
      id,
      abbreviation: timeZoneAbbreviation(at, id),
      offset: timeZoneOffset(at, id),
    }));
  }, [at, value]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      const current = options.find((option) => option.id === value);
      return current ? [current, ...options.filter((option) => option !== current).slice(0, 39)] : options.slice(0, 40);
    }

    const words = needle.split(/\s+/);
    return options
      .filter((option) => {
        const haystack = `${option.id} ${option.id.replaceAll('_', ' ')} ${option.abbreviation} ${option.offset}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .sort((a, b) => {
        const aAbbreviation = a.abbreviation.toLowerCase() === needle ? 0 : 1;
        const bAbbreviation = b.abbreviation.toLowerCase() === needle ? 0 : 1;
        const aName = a.id.toLowerCase().startsWith(needle) ? 0 : 1;
        const bName = b.id.toLowerCase().startsWith(needle) ? 0 : 1;
        return aAbbreviation - bAbbreviation || aName - bName || a.id.localeCompare(b.id);
      })
      .slice(0, 60);
  }, [options, query, value]);

  const abbreviation = timeZoneAbbreviation(at, value);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${value}`}
        title={value}
        className={cn(
          'flex h-7 shrink-0 items-center gap-0.5 rounded-sm border border-line bg-sunken px-1.5',
          'font-mono text-2xs text-ink-secondary hover:border-line-strong hover:bg-raised',
          'focus-visible:outline-focus focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...getReferenceProps()}
      >
        {abbreviation}
        <ChevronDown aria-hidden="true" className="size-3" />
      </button>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} initialFocus={searchRef} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              aria-label={label}
              className="z-50 flex w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-line bg-raised shadow-lg"
              {...getFloatingProps()}
            >
              <div className="border-b border-line p-2">
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-placeholder"
                  />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    aria-label={`Search ${label.toLowerCase()}`}
                    placeholder="Search Tokyo, Europe/London, EST…"
                    onChange={(event) => setQuery(event.target.value)}
                    className={cn(
                      'h-9 w-full rounded-md border border-line-input bg-card pr-2.5 pl-8 text-sm text-ink',
                      'placeholder:text-ink-placeholder focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
                    )}
                  />
                </div>
                <p className="mt-1.5 px-0.5 text-2xs text-ink-muted">
                  Search by IANA name or the abbreviation shown beside the time.
                </p>
              </div>

              <div role="listbox" aria-label="Time zones" className="min-h-0 overflow-y-auto py-1">
                {matches.length === 0 && (
                  <p className="px-3 py-3 text-sm text-ink-secondary">No matching time zone.</p>
                )}

                {matches.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={option.id === value}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent-soft',
                      'focus-visible:bg-accent-soft focus-visible:outline-none',
                    )}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn('size-3.5 shrink-0 text-accent-text', option.id !== value && 'invisible')}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {option.id.replaceAll('_', ' ')}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-ink-muted">
                      {option.abbreviation} · {option.offset}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

/** UTC offset at an instant, formatted for a compact option row. */
function timeZoneOffset(at: number, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((candidate) => candidate.type === 'timeZoneName')?.value;

  return (part ?? 'GMT').replace('GMT', 'UTC');
}
