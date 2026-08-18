import { cn, coloredSurfaceStyle } from '@trip/ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SearchResult } from './search';
import { buildIndex, search, type CommandId } from './search';
import type { TripDoc } from '@trip/crdt';
import { EventKindIcon } from './EventKind';

const GROUP_LABEL: Record<SearchResult['kind'], string> = {
  day: 'Days',
  event: 'Events',
  command: 'Actions',
};

/** What to press to reach the field, written the way this platform writes it. */
function shortcutHint(): string {
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  return mac ? '⌘K' : 'Ctrl K';
}

export interface SearchBarProps {
  doc: TripDoc | undefined;
  /** Takes the caret on mount, for the drawer that opens with nothing else in it. */
  autoFocus?: boolean;
  /**
   * Puts the results in the box rather than over the page below the field.
   * The drawer is the box, and a list hanging off the bottom of it would hang
   * off the bottom of the screen.
   */
  inlineResults?: boolean;
  homeTimezone: string;
  /** What is being searched for, for a container that shows something else when nothing is. */
  onQueryChange?: (query: string) => void;
  onPickEvent: (eventId: string) => void;
  onPickDay: (at: number) => void;
  onRunCommand: (command: CommandId) => void;
}

/**
 * Search across everything in the trip, and the way to get anywhere in it.
 *
 * In the header from the small breakpoint up, rather than behind a menu:
 * on a trip of any size finding the thing you half-remember is the common move
 * and scrolling for it is the slow one. A phone reaches the same field through
 * the drawer that opens from the bottom edge.
 */
export function SearchBar({
  doc,
  autoFocus = false,
  inlineResults = false,
  homeTimezone,
  onQueryChange,
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

  useEffect(() => onQueryChange?.(query), [query, onQueryChange]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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

  /*
   * Open once there is something to answer, whether or not there is an answer.
   * A search that found nothing used to close the list, which reads the same as
   * a search that has not run yet -- so a typo looked like a broken field.
   */
  const asked = query.trim() !== '';
  const showing = open && asked;

  // Rendered as a flat list with headings between, because a screen reader
  // counts options and inserting group wrappers changes what it announces.
  const rows: Array<{ heading?: string; result: SearchResult }> = [];
  let lastKind: SearchResult['kind'] | null = null;
  for (const result of results) {
    rows.push(
      result.kind === lastKind ? { result } : { heading: GROUP_LABEL[result.kind], result },
    );
    lastKind = result.kind;
  }

  return (
    <div
      className={cn(
        'relative min-w-0',
        // In a row of its own the field fills the row; in the drawer it is as
        // tall as it needs to be, and takes the rest only to show results.
        inlineResults ? cn('flex min-h-0 flex-col', showing && 'flex-1') : 'flex-1',
      )}
    >
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
          aria-activedescendant={showing && results.length > 0 ? `${listId}-${active}` : undefined}
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
            'h-9 w-full rounded-md border border-line-input bg-card pr-14 pl-8 text-sm text-ink',
            'placeholder:text-ink-placeholder',
            'focus:border-accent focus:outline-2 focus:-outline-offset-1 focus:outline-focus',
          )}
        />

        {/* The shortcut, where the shortcut is. Nothing else said it existed. */}
        {!asked && (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-sm border border-line px-1.5 py-0.5 text-2xs text-ink-muted sm:block"
          >
            {shortcutHint()}
          </kbd>
        )}
      </div>

      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className={cn(
            'z-20 mt-1 overflow-auto rounded-lg border border-line bg-raised py-1 shadow-lg',
            inlineResults ? 'min-h-0 shrink' : 'absolute top-full right-0 left-0 max-h-80',
          )}
        >
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-ink-secondary">
              Nothing matches “{query.trim()}”. Try part of a name, a city, or a date like 14 Aug.
            </li>
          )}

          {rows.map(({ heading, result }, position) => (
            <li key={result.id} role="presentation">
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
                <span
                  style={
                    result.kind === 'event' ? coloredSurfaceStyle(result.event.color) : undefined
                  }
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 text-sm text-ink',
                    result.kind === 'event' && result.event.color && 'rounded-sm px-1.5 py-0.5',
                  )}
                >
                  {result.kind === 'event' && (
                    <EventKindIcon
                      kind={result.event.kind}
                      className="size-3.5 shrink-0 text-ink-muted"
                    />
                  )}
                  <span className="truncate">{result.label}</span>
                </span>
                <span className="shrink-0 text-2xs text-ink-muted">{result.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
