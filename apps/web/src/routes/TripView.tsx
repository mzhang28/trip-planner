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
  deleteEvent,
  deleteEvents,
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
import { GripVertical, Plus, Settings, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type TripSummary } from '../lib/api';
import { randomId } from '../lib/crypto';
import { dayKey, formatDayHeading, moveToDay, setDay, setTimeOfDay } from '../lib/time';
import { addDays, eventDay, openingDay, type DayKey } from '../lib/calendar';
import { DayMap } from '../trip/DayMap';
import { DayNavigator, type CalendarView } from '../trip/DayNavigator';
import { useUploadFlush } from '../trip/Attachments';
import { RecoveryBanner } from '../trip/RecoveryBanner';
import { SharePanel } from '../trip/SharePanel';
import { MergePreview, SelectionBar } from '../trip/SelectionBar';
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
  const [draft, setDraft] = useState('');
  const [sharing, setSharing] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergePrimary, setMergePrimary] = useState<string | null>(null);
  const addBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tripId) return;
    void api
      .getTrip(tripId)
      .then(setTrip)
      .catch(() => setTrip(null));
  }, [tripId]);

  const doc = state?.doc as TripDoc | undefined;
  const homeTimezone = trip?.homeTimezone ?? doc?.meta?.homeTimezone ?? 'UTC';
  const readOnly = trip?.role === 'viewer';

  const fieldDefs = useMemo(() => liveFieldDefs(doc), [doc]);
  const zonePreference = useZonePreference();

  // Drains whatever was attached with no network, once there is one.
  useUploadFlush();
  const weather = useWeather(events);

  const [view, setView] = useState<CalendarView>('day');
  const [anchor, setAnchor] = useState<DayKey>(() => new Date().toISOString().slice(0, 10));
  const [anchored, setAnchored] = useState(false);
  const today = dayKey(Date.now(), homeTimezone);

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
    if (anchored || events.length === 0) return;

    setAnchor(openingDay(events, homeTimezone, today));
    setAnchored(true);
  }, [anchored, events, homeTimezone, today]);

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
    // Something with no time yet gets one when it lands on a day: midday, which
    // reads as "this day, time still to work out" rather than midnight.
    const from = event.startsAt ?? Date.parse(`${targetDay}T12:00:00Z`);
    const startsAt = moveToDay(from, zone, targetDay);
    if (startsAt === null || startsAt === event.startsAt) return;

    store.change((current) =>
      updateEvent(current, event.id, { startsAt, timezone: zone }, { userId: 'me' }),
    );
  }

  /**
   * Makes an event from what a gesture said, and nothing else.
   *
   * A day picked in the month, or a run of days dragged in the week, fills in
   * exactly that -- the point of the gesture is that it saves typing the thing
   * it already knows. The name is left empty and the editor opens on it, so the
   * next thing typed is the next thing decided.
   */
  function createOn(day: DayKey, options: { startMinutes?: number; endMinutes?: number } = {}) {
    if (!store || readOnly) return;

    const id = `e_${randomId()}`;

    /*
     * Midday when the gesture said nothing about the hour: it reads as "this
     * day, time still to work out" rather than claiming to start at midnight.
     *
     * The minutes come from the grid, which is drawn in the zone the trip is
     * shown in -- so they are a wall-clock time there, not an offset from
     * midnight UTC. Treating them as the latter put a nine o'clock drag at six
     * in the evening in Tokyo.
     */
    const minutes = options.startMinutes ?? 12 * 60;
    const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60,
    ).padStart(2, '0')}`;

    const onThatDay = setDay(undefined, homeTimezone, day);
    const startsAt = onThatDay === null ? null : setTimeOfDay(onThatDay, homeTimezone, clock);

    store.change((current) => {
      let next = addEvent(current, { id, name: '' }, { userId: 'me' });

      next = updateEvent(
        next,
        id,
        {
          ...(startsAt === null ? {} : { startsAt }),
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

    setView('day');
    moveAnchor(day);
    setOpenEventId(id);
    setHighlighted(id);
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

  function bulkDelete() {
    const ids = [...selected];
    store?.change((current) => deleteEvents(current, ids, { userId: 'me' }));
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

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="z-10 shrink-0 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="text-xs text-ink-muted underline-offset-2 hover:underline">
            All trips
          </Link>
          <h1 className="truncate text-lg">{trip?.name ?? 'Trip'}</h1>
          <Link
            to={`/t/${tripId}/fields`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline"
          >
            Fields
          </Link>
          <SyncBadge state={state} />
          <div className="hidden sm:flex sm:min-w-56 sm:flex-1 sm:basis-64">
            <SearchBar
              doc={doc}
              homeTimezone={homeTimezone}
              onPickEvent={focusEvent}
              onPickDay={goToDay}
              onRunCommand={runCommand}
            />
          </div>
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

        {/* Below the small breakpoint the search box gets the whole row. */}
        <div className="mx-auto w-full max-w-[100rem] px-4 pb-3 sm:hidden">
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
        className={`mx-auto min-h-0 w-full max-w-[100rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 ${
          view === 'week' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        {state && store && <RecoveryBanner state={state} store={store} />}

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

        <DayNavigator view={view} anchor={anchor} today={today} onChange={moveAnchor} />

        <div className={view === 'week' ? 'min-h-0 flex-1' : undefined}>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {view === 'week' && (
            <WeekView
              anchor={anchor}
              events={events}
              homeTimezone={homeTimezone}
              weather={weather}
              today={today}
              readOnly={readOnly}
              onOpenEvent={focusEvent}
              onChangeAnchor={moveAnchor}
              onCreateAt={(day, startMinutes, endMinutes) =>
                createOn(day, { startMinutes, endMinutes })
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
            <div className="lg:flex lg:items-start lg:gap-4">
              <div className="min-w-0 lg:flex-1 lg:max-w-4xl">
          {days.map(([key, dayEvents]) => (
            <section key={key} className="mb-8">
              <h2 className="mb-2 text-sm text-ink-muted">
                {key === UNSCHEDULED
                  ? 'No date yet'
                  : /*
                     * From the day itself, not from its first event. A day the
                     * person navigated to has no events to ask, which is
                     * exactly when it needs a heading.
                     */
                    formatDayHeading(Date.parse(`${key}T12:00:00Z`), 'UTC')}
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
                              store?.change((current) =>
                                deleteEvent(current, event.id, { userId: 'me' }),
                              )
                            }
                            doc={doc}
                            onOpenEvent={focusEvent}
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
              <aside className="mt-6 h-80 lg:sticky lg:top-0 lg:mt-0 lg:h-[calc(100dvh-11rem)] lg:w-[26rem] xl:w-[34rem] 2xl:w-[42rem]">
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
