import { cn } from '@trip/ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SearchResult } from './search';
import { buildIndex, search, type CommandId } from './search';
import type { TripDoc } from '@trip/crdt';

const GROUP_LABEL: Record<SearchResult['kind'], string> = {
  day: 'Days',
  event: 'Events',
  command: 'Actions',
};

export interface SearchBarProps {
  doc: TripDoc | undefined;
  homeTimezone: string;
  onPickEvent: (eventId: string) => void;
  onPickDay: (at: number) => void;
  onRunCommand: (command: CommandId) => void;
}

/**
 * Search across everything in the trip, and the way to get anywhere in it.
 *
 * Sits in the header on every screen rather than behind a menu, because on a
 * trip of any size finding the thing you half-remember is the common move and
 * scrolling for it is the slow one.
 */
export function SearchBar({
  doc,
  homeTimezone,
  onPickEvent,
  onPickDay,
  onRunCommand,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Rebuilt when the trip changes rather than on every keystroke.
  const index = useMemo(() => buildIndex(doc), [doc]);
  const results = useMemo(
    () => search(query, index, { homeTimezone }),
    [query, index, homeTimezone],
  );

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function choose(result: SearchResult | undefined) {
    if (!result) return;

    if (result.kind === 'event') onPickEvent(result.id);
    else if (result.kind === 'day') onPickDay(result.at);
    else onRunCommand(result.command);

    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  const showing = open && results.length > 0;

  // Rendered as a flat list with headings between, because a screen reader
  // counts options and inserting group wrappers changes what it announces.
  const rows: Array<{ heading?: string; result: SearchResult }> = [];
  let lastKind: SearchResult['kind'] | null = null;
  for (const result of results) {
    rows.push(result.kind === lastKind ? { result } : { heading: GROUP_LABEL[result.kind], result });
    lastKind = result.kind;
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-placeholder"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search this trip"
          aria-expanded={showing}
          aria-controls={showing ? listId : undefined}
          aria-activedescendant={showing ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Search or jump to a day"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // A click on a result would otherwise be lost to the blur that
          // closes the list before the click lands.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((current) => Math.min(current + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === 'Escape') {
              setQuery('');
              setOpen(false);
            }
          }}
          className={cn(
            'h-9 w-full rounded-md border border-line-input bg-card pr-3 pl-8 text-sm text-ink',
            'placeholder:text-ink-placeholder',
            'focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
          )}
        />
      </div>

      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-raised py-1 shadow-lg"
        >
          {rows.map(({ heading, result }, position) => (
            <li key={result.id}>
              {heading && (
                <div
                  aria-hidden="true"
                  className="px-3 pt-2 pb-1 text-2xs font-medium tracking-wide text-ink-muted uppercase"
                >
                  {heading}
                </div>
              )}
              <div
                id={`${listId}-${position}`}
                role="option"
                aria-selected={position === active}
                onMouseDown={() => choose(result)}
                onMouseEnter={() => setActive(position)}
                className={cn(
                  'flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5',
                  position === active && 'bg-accent-soft',
                )}
              >
                <span className="truncate text-sm text-ink">{result.label}</span>
                <span className="shrink-0 text-2xs text-ink-muted">{result.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
