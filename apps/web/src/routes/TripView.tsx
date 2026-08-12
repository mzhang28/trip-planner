import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  addAttachment,
  addEvent,
  addLink,
  deleteEvents,
  restoreEvent,
  liveFieldDefs,
  mergeEvents,
  removeAttachment,
  removeLink,
  setCustomField,
  updateEvent,
  type CustomValue,
  type EventAttachment,
  type EditableEventFields,
  type FieldDefId,
  type TripDoc,
  type TripEvent,
} from '@trip/crdt';
import { Button, IconButton, SegmentedControl, TextField, ThemeToggle } from '@trip/ui';
import { ChevronRight, GripVertical, Plus, Settings, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, api, type TripSummary } from '../lib/api';
import { randomId } from '../lib/crypto';
import { dayKey, formatDayHeading, moveToDay, setDay, setTimeOfDay } from '../lib/time';
import { clampDay, eventDay, tripDateRange, type DayKey } from '../lib/calendar';
import { DayMap } from '../trip/DayMap';
import { DayNavigator, type CalendarView } from '../trip/DayNavigator';
import { useUploadFlush } from '../trip/Attachments';
import { RecoveryBanner } from '../trip/RecoveryBanner';
import { SharePanel } from '../trip/SharePanel';
import { MergePreview, SelectionBar } from '../trip/SelectionBar';
import { UndoBar } from '../trip/UndoBar';
import { TransitLeg } from '../trip/TransitLeg';
import { MonthView } from '../trip/MonthView';
import { WeekView } from '../trip/WeekView';
import { useWeather } from '../trip/useWeather';
import { DayDropZone, DraggableEvent } from '../trip/DayDropZone';
import { EventRow } from '../trip/EventRow';
import { SearchBar } from '../trip/SearchBar';
import { SyncBadge } from '../trip/SyncBadge';
import type { CommandId } from '../trip/search';
import { useEvents, useTripState, useTripStore } from '../trip/useTrip';
import { setZonePreference, useZonePreference } from '../trip/useDisplayZone';

const UNSCHEDULED = 'unscheduled';

/** Shared so a card without revealed fields is not handed a new set each render. */
const NOTHING_REVEALED: ReadonlySet<string> = new Set();

/*
 * Times read in the zone of the place by default: a 09:00 entry in Kyoto is
 * 09:00 whether you are there or at home, which is what a plan is for. The
 * other setting is for working out whether you can call someone.
 */
const VIEW_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

const ZONE_OPTIONS = [
  { value: 'event', label: 'Local time' },
  { value: 'device', label: 'My time' },
] as const;

function groupByDay(events: TripEvent[], homeTimezone: string) {
  const days = new Map<string, TripEvent[]>();

  for (const event of events) {
    const key =
      event.startsAt === undefined
        ? UNSCHEDULED
        : dayKey(event.startsAt, event.timezone ?? homeTimezone);

    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }

  return [...days.entries()];
}

function HeaderActions({
  canShare,
  zonePreference,
  onChangeZone,
  onShare,
}: {
  canShare: boolean;
  zonePreference: 'event' | 'device';
  onChangeZone: (value: 'event' | 'device') => void;
  onShare: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative flex items-center gap-1">
      {canShare && (
        <IconButton label="Share trip" variant="secondary" onPress={onShare}>
          <Share2 aria-hidden="true" />
        </IconButton>
      )}

      <IconButton
        label="Settings"
        variant="secondary"
        aria-expanded={open}
        aria-haspopup="dialog"
        onPress={() => setOpen((current) => !current)}
      >
        <Settings aria-hidden="true" />
      </IconButton>

      {open && (
        <div
          role="dialog"
          aria-label="Settings"
          className="absolute top-full right-0 z-30 mt-2 flex w-72 flex-col gap-4 rounded-lg border border-line bg-raised p-4 shadow-lg"
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-secondary">Show times in</span>
            <SegmentedControl
              label="Show times in"
              options={ZONE_OPTIONS}
              value={zonePreference}
              onChange={onChangeZone}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-secondary">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}

export function TripView() {
  const { tripId } = useParams<{ tripId: string }>();
  const store = useTripStore(tripId);
  const state = useTripState(store);
  const events = useEvents(state);

  const [trip, setTrip] = useState<TripSummary | null>(null);

  /*
   * What the server said about this trip, which is not the same question as
   * whether the trip is on this device. A replica exists offline either way.
   */
  const [access, setAccess] = useState<'asking' | 'open' | 'missing' | 'refused' | 'unreachable'>(
    'asking',
  );
  const [draft, setDraft] = useState('');
  const [sharing, setSharing] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  /*
   * Which optional fields each open event has been asked to show. Held here
   * because setting a date moves the card to another day and remounts it.
   */
  const [revealedFields, setRevealedFields] = useState<Record<string, ReadonlySet<string>>>({});

  /** The last deletion, while it can still be taken back. */
  const [undoable, setUndoable] = useState<{ ids: string[]; message: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergePrimary, setMergePrimary] = useState<string | null>(null);
  const addBoxRef = useRef<HTMLDivElement>(null);

  /**
   * Asks the server whether this trip is open to this person.
   *
   * Three different answers, and they used to look the same: a trip called
   * "Trip" with every control working and a status saying the work was saved.
   * Two of them mean nothing typed here will ever arrive.
   */
  const retryAccess = useCallback(() => {
    if (!tripId) return;

    setAccess('asking');
    void api
      .getTrip(tripId)
      .then((summary) => {
        setTrip(summary);
        setAccess('open');
      })
      .catch((error: unknown) => {
        setTrip(null);
        if (error instanceof ApiError) setAccess(error.status === 403 ? 'refused' : 'missing');
        else setAccess('unreachable');
      });
  }, [tripId]);

  useEffect(retryAccess, [retryAccess]);

  const doc = state?.doc as TripDoc | undefined;
  const homeTimezone = trip?.homeTimezone ?? doc?.meta?.homeTimezone ?? 'UTC';

  /*
   * Nothing may be changed until the server has said this trip can be. Offline
   * is the exception the whole app is built for: a copy that was reached before
   * is still editable, and the sync badge says where the work is sitting.
   */
  const readOnly = trip?.role === 'viewer' || access === 'asking';

  const fieldDefs = useMemo(() => liveFieldDefs(doc), [doc]);
  const zonePreference = useZonePreference();

  // Drains whatever was attached with no network, once there is one.
  useUploadFlush();
  const weather = useWeather(events, homeTimezone);

  const [view, setView] = useState<CalendarView>('day');
  const [anchor, setAnchor] = useState<DayKey>(() => new Date().toISOString().slice(0, 10));
  const [anchored, setAnchored] = useState(false);
  const today = dayKey(Date.now(), homeTimezone);
  const tripRange = useMemo(
    () => tripDateRange(doc?.meta, events, homeTimezone, today),
    [doc?.meta, events, homeTimezone, today],
  );

  /**
   * Moves the view, and records that it was moved on purpose.
   *
   * Everything that changes the day goes through here so the opening guess
   * below cannot fire afterwards. Without that, navigating to a future day and
   * adding to it would make the trip non-empty, which would then send the view
   * somewhere else -- the person would be moved off the day they had just
   * chosen, by the act of using it.
   */
  const moveAnchor = useCallback((day: DayKey) => {
    setAnchor(day);
    setAnchored(true);
  }, []);

  /*
   * The opening guess, once, and only while the person has not chosen a day.
   */
  useEffect(() => {
    if (anchored) return;

    setAnchor(clampDay(today, tripRange.start, tripRange.end));
    setAnchored(true);
  }, [anchored, today, tripRange]);

  // A range can change on another device while this view is open. The week
  // must never point at a day its finite strip no longer contains.
  useEffect(() => {
    if (view !== 'week') return;
    const bounded = clampDay(anchor, tripRange.start, tripRange.end);
    if (bounded !== anchor) moveAnchor(bounded);
  }, [anchor, moveAnchor, tripRange, view]);

  const days = useMemo(() => {
    const grouped = groupByDay(events, homeTimezone);

    /*
     * The anchored day is always present, even with nothing on it. Without it
     * there is no way to add to a day that is empty, which is every day of a
     * trip before it is planned.
     */
    if (view === 'day' && !grouped.some(([key]) => key === anchor)) {
      grouped.push([anchor, []]);
    }

    return grouped.sort(([a], [b]) => {
      if (a === UNSCHEDULED) return 1;
      if (b === UNSCHEDULED) return -1;
      return a.localeCompare(b);
    });
  }, [events, homeTimezone, view, anchor]);

  /*
   * The map shows the day the list is anchored on, not the whole trip. Pins
   * numbered one to forty across three weeks would say nothing about the order
   * of anything.
   */
  const mappable = useMemo(
    () => events.filter((event) => eventDay(event, homeTimezone) === anchor),
    [events, homeTimezone, anchor],
  );

  /*
   * The keyboard sensor is not optional. Dragging is the only way to move an
   * event between days, so without it that operation would be unreachable for
   * anyone not using a pointer. The grip is a real button, so it is tabbed to
   * and driven with the arrow keys.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const create = useCallback(() => {
    const name = draft.trim();
    if (!name || !store) return;

    store.change((current) =>
      addEvent(current, { id: `e_${randomId()}`, name }, { userId: 'me' }),
    );
    setDraft('');
  }, [draft, store]);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || !store) return;

    const targetDay = String(over.id).replace(/^day:/, '');
    const event = events.find((candidate) => candidate.id === active.id);
    if (!event || targetDay === UNSCHEDULED) return;

    const zone = event.timezone ?? homeTimezone;

    /*
     * Dropping on a day says which day and nothing about the hour, so one that
     * had no time still has none. Its instant is midnight there, which names
     * the day without claiming to be when it starts.
     */
    const timed = event.startsAt !== undefined && !event.timeUndecided;
    const startsAt = timed
      ? moveToDay(event.startsAt!, zone, targetDay)
      : setDay(undefined, zone, targetDay);
    if (startsAt === null || startsAt === event.startsAt) return;

    store.change((current) =>
      updateEvent(
        current,
        event.id,
        { startsAt, timezone: zone, timeUndecided: timed ? undefined : true },
        { userId: 'me' },
      ),
    );
  }

  /**
   * Makes an event from what a gesture said, and nothing else.
   *
   * A calendar gesture fills in exactly what it knows. Month and day creation
   * leave the name empty and open the editor. Week creation collects the name
   * first, then calls this without opening it.
   */
  function createOn(
    day: DayKey,
    options: {
      startMinutes?: number;
      endMinutes?: number;
      name?: string;
      openAfterCreate?: boolean;
    } = {},
  ) {
    if (!store || readOnly) return;

    const id = `e_${randomId()}`;

    /*
     * The minutes come from the grid, which is drawn in the zone the trip is
     * shown in -- so they are a wall-clock time there, not an offset from
     * midnight UTC. Treating them as the latter put a nine o'clock drag at six
     * in the evening in Tokyo.
     *
     * A tap on a day says nothing about the hour, and the event records that
     * rather than being given one.
     */
    const onThatDay = setDay(undefined, homeTimezone, day);
    const minutes = options.startMinutes;
    const startsAt =
      onThatDay === null || minutes === undefined
        ? onThatDay
        : setTimeOfDay(
            onThatDay,
            homeTimezone,
            `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
          );

    store.change((current) => {
      let next = addEvent(current, { id, name: options.name ?? '' }, { userId: 'me' });

      next = updateEvent(
        next,
        id,
        {
          ...(startsAt === null ? {} : { startsAt }),
          ...(minutes === undefined ? { timeUndecided: true } : {}),
          timezone: homeTimezone,
          // How long only when the gesture said so. A tap on a day says which
          // day and nothing about length.
          ...(options.endMinutes !== undefined && options.startMinutes !== undefined
            ? { durationMinutes: options.endMinutes - options.startMinutes }
            : {}),
        },
        { userId: 'me' },
      );

      return next;
    });

    if (options.openAfterCreate !== false) {
      setView('day');
      moveAnchor(day);
      setOpenEventId(id);
      setHighlighted(id);
    }
  }

  function goToDay(at: number) {
    const key = dayKey(at, homeTimezone);
    moveAnchor(key);

    // The day may not be on screen yet in week or month view, so move the
    // window first and scroll once React has drawn it.
    requestAnimationFrame(() =>
      document.querySelector(`[data-testid="day-${key}"]`)?.scrollIntoView({ block: 'center' }),
    );
  }

  function focusEvent(eventId: string) {
    setView('day');
    setHighlighted(eventId);
    setOpenEventId(eventId);
    document.getElementById(`event-${eventId}`)?.scrollIntoView({ block: 'center' });
  }

  function toggleSelected(eventId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  /**
   * Deletes, and keeps the way back open for a few seconds.
   *
   * Undo puts the events back through `restoreEvent`, which clears the
   * tombstone as an ordinary edit -- so it merges like any other and a peer
   * that never saw the delete is not confused by the reversal.
   */
  function removeEvents(ids: string[], message: string) {
    if (ids.length === 0) return;

    store?.change((current) => deleteEvents(current, ids, { userId: 'me' }));
    setUndoable({ ids, message });
  }

  function bulkDelete() {
    const ids = [...selected];
    removeEvents(
      ids,
      ids.length === 1 ? 'Deleted 1 event' : `Deleted ${ids.length} events`,
    );
    setSelected(new Set());
  }

  function confirmMerge() {
    const primary = mergePrimary ?? [...selected][0];
    if (!primary) return;

    store?.change((current) =>
      mergeEvents(
        current,
        primary,
        [...selected].filter((id) => id !== primary),
        { userId: 'me' },
      ),
    );

    setSelected(new Set());
    setMergePrimary(null);
  }

  function share() {
    setSharing(true);
  }

  function runCommand(command: CommandId) {
    if (command === 'new-event') {
      addBoxRef.current?.querySelector('input')?.focus();
    } else if (command === 'today') {
      goToDay(Date.now());
    } else if (command === 'share') {
      share();
    }
  }

  /*
   * A trip that is not there, or not yours, gets a page of its own rather than
   * an empty itinerary with working controls. Anything typed into that would
   * have been refused by the server for as long as the tab stayed open.
   */
  if (access === 'missing' || access === 'refused') {
    return (
      <div className="grid h-dvh place-items-center overflow-hidden bg-page px-6 text-center text-ink">
        <div data-testid="no-access" className="max-w-md">
          <h1 className="mb-2 text-xl">
            {access === 'missing' ? 'This trip is not here' : 'You cannot open this trip'}
          </h1>
          <p className="mb-4 text-ink-secondary">
            {access === 'missing'
              ? 'The address may be wrong, or the trip may have been deleted. Nothing you type here would be saved.'
              : 'Your access was removed, or the link you used was revoked. Ask whoever owns the trip for a new link.'}
          </p>
          <Link
            to="/"
            className="text-sm text-accent-text underline underline-offset-2 hover:no-underline"
          >
            All trips
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="z-10 shrink-0 border-b border-line bg-page/95 backdrop-blur">
        <div
          data-testid="trip-toolbar"
          className="relative flex w-full flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="text-xs text-ink-muted underline-offset-2 hover:underline">
              All trips
            </Link>
            <h1 className="max-w-48 truncate text-lg xl:max-w-80">{trip?.name ?? 'Trip'}</h1>
            <Link
              to={`/t/${tripId}/fields`}
              className="text-xs text-ink-muted underline-offset-2 hover:underline"
            >
              Trip settings
            </Link>
            <SyncBadge state={state} />
          </div>
          <div className="absolute left-1/2 hidden w-[36vw] min-w-64 max-w-lg -translate-x-1/2 lg:flex">
            <SearchBar
              doc={doc}
              homeTimezone={homeTimezone}
              onPickEvent={focusEvent}
              onPickDay={goToDay}
              onRunCommand={runCommand}
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SegmentedControl
              label="Calendar view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
            <HeaderActions
              canShare={trip?.role === 'owner'}
              zonePreference={zonePreference}
              onChangeZone={setZonePreference}
              onShare={share}
            />
          </div>
        </div>

        {/* Below the large breakpoint the search box gets the whole row. */}
        <div className="w-full px-4 pb-3 lg:hidden">
          <SearchBar
            doc={doc}
            homeTimezone={homeTimezone}
            onPickEvent={focusEvent}
            onPickDay={goToDay}
            onRunCommand={runCommand}
          />
        </div>
      </header>

      <main
        className={`min-h-0 w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 ${
          view === 'month' ? 'overflow-y-auto' : 'flex flex-col overflow-hidden'
        }`}
      >
        <div className={view === 'month' ? undefined : 'shrink-0'}>
        {state && store && <RecoveryBanner state={state} store={store} />}

        {/*
          Your copy, unchecked. Editing stays open because that is what this app
          is for, but the trip could not be confirmed to still exist or still be
          yours -- which is worth knowing before an afternoon of planning.
        */}
        {access === 'unreachable' && (
          <div
            role="status"
            data-testid="offline-copy"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sunken px-4 py-3"
          >
            <p className="min-w-0 flex-1 text-sm text-ink">
              Showing your copy of this trip. The server could not be reached, so changes stay on
              this device until it can be.
            </p>
            <Button size="sm" onPress={() => retryAccess()}>
              Try again
            </Button>
          </div>
        )}

        {!readOnly && (
          <div ref={addBoxRef} className="mb-6 flex items-end gap-2">
            <TextField
              label="New event"
              labelHidden
              className="flex-1"
              placeholder="Add something — a name is enough"
              value={draft}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />
            <Button variant="primary" onPress={create} isDisabled={draft.trim() === ''}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        )}

        {events.length === 0 && (
          <p className="py-10 text-center text-ink-secondary">
            Nothing here yet. Add the first thing you know about — where you are staying, or the
            flight out.
          </p>
        )}

        <DayNavigator
          view={view}
          anchor={anchor}
          today={today}
          tripStart={tripRange.start}
          tripEnd={tripRange.end}
          onChange={moveAnchor}
        />
        </div>

        <div className={view === 'month' ? undefined : 'min-h-0 flex-1 overflow-hidden'}>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {view === 'week' && (
            <WeekView
              anchor={anchor}
              tripStart={tripRange.start}
              tripEnd={tripRange.end}
              events={events}
              homeTimezone={homeTimezone}
              weather={weather}
              today={today}
              readOnly={readOnly}
              onOpenEvent={focusEvent}
              onCreateAt={(day, name, startMinutes, endMinutes) =>
                createOn(day, { startMinutes, endMinutes, name, openAfterCreate: false })
              }
            />
          )}

          {view === 'month' && (
            <MonthView
              anchor={anchor}
              events={events}
              homeTimezone={homeTimezone}
              weather={weather}
              today={today}
              readOnly={readOnly}
              onOpenDay={(day) => {
                moveAnchor(day);
                setView('day');
              }}
              onCreateOn={(day) => createOn(day)}
            />
          )}

          {view === 'day' && (
            <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
              <div
                data-testid="day-list-scroll"
                className="min-h-0 min-w-0 flex-1 overflow-y-auto lg:pr-1"
              >
          {days.map(([key, dayEvents]) => (
            <section key={key} className="mb-8">
              <h2 className="mb-2 text-sm text-ink-muted">
                {key === UNSCHEDULED ? (
                  'No date yet'
                ) : (
                  <button
                    type="button"
                    data-testid={`day-heading-${key}`}
                    onClick={() => {
                      moveAnchor(key);
                      setView('week');
                    }}
                    className="inline-flex items-center gap-1 rounded-sm hover:text-ink focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {/*
                     * From the day itself, not from its first event. A day the
                     * person navigated to has no events to ask, which is
                     * exactly when it needs a heading.
                     */}
                    {formatDayHeading(Date.parse(`${key}T12:00:00Z`), 'UTC')}
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </h2>

              <DayDropZone dayKey={key} disabled={readOnly || key === UNSCHEDULED}>
                {dayEvents.length === 0 && !readOnly && (
                  <button
                    type="button"
                    data-testid={`add-on-${key}`}
                    onClick={() => createOn(key)}
                    className="w-full rounded-lg border border-dashed border-line-default px-3 py-6 text-sm text-ink-muted hover:border-accent hover:bg-accent-soft hover:text-accent-text focus-visible:outline-focus focus-visible:outline-2"
                  >
                    Nothing on this day yet. Add something.
                  </button>
                )}

                <div className="flex flex-col gap-2">
                  {dayEvents.map((event, index) => (
                    <div key={event.id}>
                      <TransitLeg event={event} previous={dayEvents[index - 1]} />
                      <DraggableEvent id={event.id} disabled={readOnly}>
                      {(handle) => (
                        <div
                          id={`event-${event.id}`}
                          className={
                            highlighted === event.id ? 'rounded-lg ring-2 ring-accent' : undefined
                          }
                        >
                          <EventRow
                            dragHandle={
                              handle ? (
                                <button
                                  {...handle}
                                  type="button"
                                  aria-label={`Move ${event.name} to another day`}
                                  className="cursor-grab touch-none px-1 text-ink-placeholder hover:text-ink-muted focus-visible:outline-focus focus-visible:outline-2"
                                >
                                  <GripVertical aria-hidden="true" className="size-4" />
                                </button>
                              ) : undefined
                            }
                            event={event}
                            isSelected={selected.has(event.id)}
                            onToggleSelected={() => toggleSelected(event.id)}
                            selectionActive={selected.size > 0}
                            isOpen={openEventId === event.id}
                            onToggle={() =>
                              setOpenEventId((current) =>
                                current === event.id ? null : event.id,
                              )
                            }
                            homeTimezone={homeTimezone}
                            fieldDefs={fieldDefs}
                            readOnly={readOnly}
                            onPatch={(patch) =>
                              store?.change((current) =>
                                updateEvent(
                                  current,
                                  event.id,
                                  patch as Partial<EditableEventFields>,
                                  { userId: 'me' },
                                ),
                              )
                            }
                            onAddLink={(url, title) =>
                              store?.change((current) =>
                                addLink(
                                  current,
                                  event.id,
                                  `l_${randomId()}`,
                                  { url, title },
                                  { userId: 'me' },
                                ),
                              )
                            }
                            onRemoveLink={(linkId) =>
                              store?.change((current) =>
                                removeLink(current, event.id, linkId, { userId: 'me' }),
                              )
                            }
                            onSetCustomField={(fieldId: FieldDefId, value: CustomValue | undefined) =>
                              store?.change((current) =>
                                setCustomField(current, event.id, fieldId, value, {
                                  userId: 'me',
                                }),
                              )
                            }
                            onAddAttachment={(id, attachment: EventAttachment) =>
                              store?.change((current) =>
                                addAttachment(current, event.id, id, attachment, {
                                  userId: 'me',
                                }),
                              )
                            }
                            onRemoveAttachment={(id) =>
                              store?.change((current) =>
                                removeAttachment(current, event.id, id, { userId: 'me' }),
                              )
                            }
                            onDelete={() =>
                              removeEvents(
                                [event.id],
                                `Deleted ${event.name || 'the unnamed event'}`,
                              )
                            }
                            doc={doc}
                            onOpenEvent={focusEvent}
                            revealed={revealedFields[event.id] ?? NOTHING_REVEALED}
                            onReveal={(key) =>
                              setRevealedFields((current) => ({
                                ...current,
                                [event.id]: new Set(current[event.id]).add(key),
                              }))
                            }
                          />
                          </div>
                        )}
                      </DraggableEvent>
                    </div>
                  ))}
                </div>
              </DayDropZone>
            </section>
          ))}
              </div>

              {/*
                Beside the timeline from the large breakpoint up, and below it
                on anything narrower. A map squeezed into a phone column shows
                less than the list it is competing with for the space.
              */}
              {/*
                Takes its space only when there is a pin to put in it. Before
                that the panel is one line, and the itinerary has the width.
              */}
              <aside
                className={
                  mappable.some((event) => event.location?.lat !== undefined)
                    ? 'h-48 shrink-0 sm:h-64 lg:h-full lg:w-[26rem] xl:w-[34rem] 2xl:w-[42rem]'
                    : 'shrink-0 lg:w-[26rem] xl:w-[34rem] 2xl:w-[42rem]'
                }
              >
                <DayMap
                  events={mappable}
                  selectedId={highlighted}
                  onSelect={(eventId) => {
                    setHighlighted(eventId);
                    setOpenEventId(eventId);
                  }}
                />
              </aside>
            </div>
          )}
        </DndContext>
        </div>

        {sharing && tripId && <SharePanel tripId={tripId} onClose={() => setSharing(false)} />}

        {selected.size > 0 && (
          <SelectionBar
            selected={selected}
            events={events}
            dayEvents={mappable}
            onSelectAll={(ids) => setSelected(new Set(ids))}
            onClear={() => setSelected(new Set())}
            onDelete={bulkDelete}
            onMerge={() => setMergePrimary([...selected][0] ?? null)}
          />
        )}

        {/* Never both: the selection bar is in the same place at the bottom. */}
        {undoable && selected.size === 0 && (
          <UndoBar
            message={undoable.message}
            onUndo={() => {
              store?.change((current) =>
                undoable.ids.reduce(
                  (doc, id) => restoreEvent(doc, id, { userId: 'me' }),
                  current,
                ),
              );
              setUndoable(null);
            }}
            onDismiss={() => setUndoable(null)}
          />
        )}

        {mergePrimary && (
          <MergePreview
            primary={events.find((event) => event.id === mergePrimary)!}
            others={events.filter(
              (event) => selected.has(event.id) && event.id !== mergePrimary,
            )}
            onChangePrimary={setMergePrimary}
            onConfirm={confirmMerge}
            onCancel={() => setMergePrimary(null)}
          />
        )}
      </main>
    </div>
  );
}
