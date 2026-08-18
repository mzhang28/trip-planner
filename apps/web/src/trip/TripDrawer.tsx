import type { TripDoc } from '@trip/crdt';
import { ThemeToggle, cn } from '@trip/ui';
import {
  CalendarDays,
  ChevronUp,
  Files,
  List,
  ListChecks,
  Menu,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { SearchBar } from './SearchBar';
import type { CommandId } from './search';

/** What the field in the drawer searches, on the screen that has one. */
export interface DrawerSearch {
  doc: TripDoc | undefined;
  homeTimezone: string;
  onPickEvent: (eventId: string) => void;
  onPickDay: (at: number) => void;
  onRunCommand: (command: CommandId) => void;
}

export interface TripDrawerProps {
  tripId: string;
  /** Absent on the screens that have nothing of their own to search. */
  search?: DrawerSearch;
  /** What this screen puts in the drawer, given the way to close it afterwards. */
  actions?: (close: () => void) => ReactNode;
}

/** One tile of the drawer's grid: a screen of the trip, or a thing to do. */
export const TILE =
  'flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-card text-sm text-ink hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2 disabled:text-ink-placeholder';

/** The screens of a trip, as the sidebar lists them at wider widths. */
const SCREENS = [
  { label: 'Itinerary', path: '', icon: CalendarDays },
  { label: 'To-dos', path: '/todos', icon: ListChecks },
  { label: 'Files', path: '/files', icon: Files },
  { label: 'Settings', path: '/fields', icon: Settings },
] as const;

/** How far a finger has to travel before it counts as a drag rather than a tap. */
const DRAG_TO_OPEN = 24;

/** How far the open drawer has to be pulled down before letting go closes it. */
const DRAG_TO_CLOSE = 96;

/**
 * The phone's bottom edge, on every screen of a trip: a bar that opens a drawer
 * holding the way to the trip's other screens and whatever this one puts there.
 *
 * On the itinerary the bar is the search field, and tapping it opens the drawer
 * on that field with the keyboard up, because that is what tapping a search box
 * asks for. Dragging the bar up opens the same drawer without the keyboard, on
 * the controls -- which is where everything that used to sit along the top of a
 * phone lives now, the end of the screen furthest from a thumb.
 */
export function TripDrawer({ tripId, search, actions }: TripDrawerProps) {
  const location = useLocation();
  const [open, setOpen] = useState<'field' | 'controls' | null>(null);
  const [searching, setSearching] = useState(false);

  /*
   * How far the open drawer has been pulled down, in pixels. It follows the
   * finger so that a pull that is not far enough springs back and says so,
   * rather than the drawer either closing or doing nothing at all.
   */
  const [pulled, setPulled] = useState(0);
  const dragFrom = useRef<number | null>(null);

  /*
   * Whether the last press on the bar turned into a drag. The bar captures the
   * pointer so that a finger leaving it keeps being followed, and a captured
   * pointer still ends in a click -- which would open the drawer a second time
   * on the field, with the keyboard over the controls just asked for.
   */
  const dragged = useRef(false);

  const close = useCallback(() => {
    setOpen(null);
    setPulled(0);
  }, []);

  const onQueryChange = useCallback((query: string) => setSearching(query.trim() !== ''), []);

  return (
    /*
     * The bar stays in the layout, which is what keeps the last card of a day
     * clear of it instead of behind it. It takes a z-index only while the
     * drawer is open, so the drawer covers the header and the day list -- and
     * so the selection and undo bars, which are fixed to the same edge, cover
     * the closed bar rather than the other way round.
     */
    <div
      className={cn(
        'shrink-0 border-t border-line bg-page px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        open && 'relative z-40',
      )}
    >
      <button
        type="button"
        data-testid="open-drawer"
        aria-expanded={open !== null}
        onClick={() => {
          if (dragged.current) dragged.current = false;
          else setOpen(search ? 'field' : 'controls');
        }}
        onPointerDown={(event) => {
          dragFrom.current = event.clientY;
          dragged.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragFrom.current === null) return;
          if (event.clientY - dragFrom.current > -DRAG_TO_OPEN) return;

          // Far enough up to be a drag: the controls, and no keyboard over them.
          dragFrom.current = null;
          dragged.current = true;
          setOpen('controls');
        }}
        onPointerUp={(event) => {
          dragFrom.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        className="flex h-9 w-full touch-none items-center gap-2 rounded-md border border-line-input bg-card px-2.5 text-left text-sm text-ink-placeholder hover:border-accent focus-visible:outline-focus focus-visible:outline-2"
      >
        {search ? (
          <Search aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <Menu aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {search ? 'Search or jump to a day' : 'Trip menu'}
        </span>
        <ChevronUp aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      </button>

      {open && (
        <>
          {/* Tapping the itinerary behind the drawer puts it away again. */}
          <div aria-hidden="true" onClick={close} className="fixed inset-0 bg-overlay" />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Trip menu"
            data-testid="trip-drawer"
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
            style={pulled > 0 ? { transform: `translateY(${pulled}px)` } : undefined}
            /*
             * The field sits at the top of the drawer and the results run down
             * from it, so the on-screen keyboard covers the end of a long list
             * rather than the box being typed into.
             */
            className={cn(
              'fixed inset-x-0 bottom-0 flex max-h-[85dvh] flex-col gap-3 rounded-t-2xl border-t border-line bg-raised p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg',
              // A fixed height where there is a field, so the drawer is the
              // same size whether it is showing results or the controls; the
              // height of what is in it where there is nothing to search.
              search && 'h-[32rem]',
            )}
          >
            {/*
              The strip a finger pulls the drawer down by. The list below it
              scrolls, so the drag has to live somewhere the drawer does not
              also need for scrolling.
            */}
            <div
              className="flex touch-none items-center justify-between"
              onPointerDown={(event) => {
                dragFrom.current = event.clientY;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragFrom.current === null) return;
                setPulled(Math.max(0, event.clientY - dragFrom.current));
              }}
              onPointerUp={() => {
                dragFrom.current = null;
                if (pulled > DRAG_TO_CLOSE) close();
                else setPulled(0);
              }}
            >
              <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
              <button
                type="button"
                aria-label="Close"
                data-testid="close-drawer"
                onClick={close}
                className="rounded-md p-1 text-ink-muted hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            {search && (
              <SearchBar
                autoFocus={open === 'field'}
                inlineResults
                doc={search.doc}
                homeTimezone={search.homeTimezone}
                onQueryChange={onQueryChange}
                onPickEvent={(eventId) => {
                  close();
                  search.onPickEvent(eventId);
                }}
                onPickDay={(at) => {
                  close();
                  search.onPickDay(at);
                }}
                onRunCommand={(command) => {
                  close();
                  search.onRunCommand(command);
                }}
              />
            )}

            {/*
              The results take the drawer while there is a search to answer.
              Both in it at once would push the controls off the bottom edge
              exactly when a list needs the room.
            */}
            {!searching && (
              <div
                data-testid="drawer-controls"
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
              >
                {actions?.(close)}

                {/* The trip's other screens, in the order the sidebar lists them. */}
                <div className="grid grid-cols-2 gap-2">
                  {SCREENS.map(({ label, path, icon: Icon }) => {
                    const to = `/t/${tripId}${path}`;
                    const here = location.pathname === to;

                    return (
                      <Link
                        key={label}
                        to={to}
                        onClick={close}
                        aria-current={here ? 'page' : undefined}
                        className={cn(TILE, here && 'bg-accent-soft font-medium text-accent-text')}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        {label}
                      </Link>
                    );
                  })}

                  <Link to="/" onClick={close} className={TILE}>
                    <List aria-hidden="true" className="size-4" />
                    All trips
                  </Link>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-ink-secondary">Theme</span>
                  <ThemeToggle />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
