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
  addTodo,
  clearField,
  deleteEvents,
  fieldContents,
  restoreEvent,
  restoreField,
  liveFieldDefs,
  mergeEvents,
  removeAttachment,
  removeLink,
  removeTodo,
  setCityColor,
  setCustomField,
  setDayZone,
  updateEvent,
  updateTodo,
  type CustomValue,
  type EventAttachment,
  type EditableEventFields,
  type EditableTodo,
  type FieldDefId,
  type TripDoc,
  type TripEvent,
} from '@trip/crdt';
import {
  Button,
  IconButton,
  SegmentedControl,
  ThemeToggle,
  coloredSurfaceStyle,
} from '@trip/ui';
import { ChevronRight, GripVertical, Plus, Settings, Share2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, api, type TripSummary } from '../lib/api';
import { randomId } from '../lib/crypto';
import { dayKey, formatDayHeading, moveToDay, setDay, setTimeOfDay } from '../lib/time';
import {
  addDays,
  clampDay,
  daysInRange,
  eventDay,
  tripDateRange,
  type DayKey,
} from '../lib/calendar';
import { daySlots, slotForInstant, zoneOfDay, type DaySlot } from '../lib/dayZones';
import { PHONE, useMediaQuery } from '../lib/useMediaQuery';
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
import { TripChrome } from '../trip/TripChrome';
import { TILE } from '../trip/TripDrawer';
import type { CommandId } from '../trip/search';
import { useEvents, useTripState, useTripStore } from '../trip/useTrip';
import { setZonePreference, useZonePreference } from '../trip/useDisplayZone';

const UNSCHEDULED = 'unscheduled';

/** How many steps back Ctrl+Z can walk. */
const UNDO_DEPTH = 30;

/** Shared so a card without revealed fields is not handed a new set each render. */
const NOTHING_REVEALED: ReadonlySet<string> = new Set();

/*
 * Times read in the zone of the place by default: a 09:00 entry in Kyoto is
 * 09:00 whether you are there or at home, which is what a plan is for. The
 * other setting is for working out whether you can call someone.
 */
const VIEW_OPTIONS = [
  { value: 'day', label: 'Day', short: 'D' },
  { value: 'week', label: 'Week', short: 'W' },
  { value: 'month', label: 'Month', short: 'M' },
] as const;

const ZONE_OPTIONS = [
  { value: 'event', label: 'Local time' },
  { value: 'device', label: 'My time' },
] as const;

/**
 * The itinerary, day by day.
 *
 * A day is the slot the instant falls in, so the list agrees with the week
 * about which day a thing is on -- including on a travel day, which runs from
 * its own morning to the next one wherever that is. An instant outside the
 * trip's own days still gets a day of its own, read in the event's zone: it is
 * something to show, not something to drop.
 */
function groupByDay(events: TripEvent[], slots: DaySlot[], homeTimezone: string) {
  const days = new Map<string, TripEvent[]>();

  for (const event of events) {
    const key =
      event.startsAt === undefined
        ? UNSCHEDULED
        : (slotForInstant(slots, event.startsAt) ??
          dayKey(event.startsAt, event.timezone ?? homeTimezone));

    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }

  return [...days.entries()];
}

function middleDay(start: DayKey, end: DayKey): DayKey {
  const dayMilliseconds = 24 * 60 * 60 * 1000;
  const duration = Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`);
  return addDays(start, Math.floor(duration / dayMilliseconds / 2));
}

/**
 * What the itinerary adds to the phone's drawer.
 *
 * A phone header has room for the trip's name and whether it is saved, and the
 * rest of it was a row of small targets along the top. Here they are one thumb
 * away, above the links to the trip's other screens that the drawer always has.
 */
function PhoneActions({
  readOnly,
  onCreate,
  canShare,
  onShare,
  undoLabel,
  onUndo,
  zonePreference,
  onChangeZone,
  onDone,
}: {
  readOnly: boolean;
  onCreate: () => void;
  canShare: boolean;
  onShare: () => void;
  /** What pressing undo would take back, or absent when there is nothing. */
  undoLabel: string | undefined;
  onUndo: () => void;
  zonePreference: 'event' | 'device';
  onChangeZone: (value: 'event' | 'device') => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {!readOnly && (
        <Button
          variant="primary"
          onPress={() => {
            onCreate();
            onDone();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Add event
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {canShare && (
          <button
            type="button"
            className={TILE}
            onClick={() => {
              onShare();
              onDone();
            }}
          >
            <Share2 aria-hidden="true" className="size-4" />
            Share
          </button>
        )}

        {/* Says what it would take back, because by the time somebody looks for
            it they may no longer be sure what the last thing was. */}
        <button
          type="button"
          className={TILE}
          data-testid="undo-last"
          disabled={undoLabel === undefined}
          aria-label={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
          onClick={() => {
            onUndo();
            onDone();
          }}
        >
          <Undo2 aria-hidden="true" className="size-4" />
          Undo
        </button>
      </div>

      {/* A setting changes what is on the screen rather than moving off it, so
          using one leaves the drawer where it is. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-secondary">Show times in</span>
        <SegmentedControl
          label="Show times in"
          options={ZONE_OPTIONS}
          value={zonePreference}
          onChange={onChangeZone}
        />
      </div>
    </div>
  );
}

function HeaderActions({
  canShare,
  zonePreference,
  undoLabel,
  onUndo,
  onChangeZone,
  onShare,
}: {
  canShare: boolean;
  zonePreference: 'event' | 'device';
  /** What pressing undo would take back, or absent when there is nothing. */
  undoLabel: string | undefined;
  onUndo: () => void;
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
      {/*
        Says what it would take back rather than just "Undo", because by the
        time somebody looks for it they may no longer be sure what the last
        thing was. Ctrl+Z does the same thing without coming up here.
      */}
      <IconButton
        label={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
        variant="secondary"
        data-testid="undo-last"
        isDisabled={undoLabel === undefined}
        onPress={onUndo}
      >
        <Undo2 aria-hidden="true" />
      </IconButton>

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
          className="absolute top-full right-0 z-50 mt-2 flex w-72 flex-col gap-4 rounded-lg border border-line bg-raised p-4 shadow-lg"
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
  const [sharing, setSharing] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  /*
   * Which optional fields each open event has been asked to show. Held here
   * because setting a date moves the card to another day and remounts it.
   */
  const [revealedFields, setRevealedFields] = useState<Record<string, ReadonlySet<string>>>({});

  /*
   * The itinerary holds every day of the trip, so moving the navigation used
   * to change the map and the range label while the list stayed where it was
   * -- Earlier and Later appeared to do nothing to the thing being read.
   */
  const dayListRef = useRef<HTMLDivElement>(null);
  /** An event chosen before the day view has mounted its list. */
  const pendingEventScrollRef = useRef<string | null>(null);

  /**
   * The way back from each thing that has been done, most recent last.
   *
   * A stack rather than a single slot, because Ctrl+Z is expected to keep
   * going: moving three events and pressing it three times should leave the
   * week as it was. Each entry carries its own way back rather than an id and a
   * kind -- moving an event and taking a field off one have nothing in common
   * to write down.
   *
   * Bounded, because these hold the values they would put back and a long
   * afternoon of edits should not be a leak.
   */
  const [undos, setUndos] = useState<Array<{ message: string; revert: () => void }>>([]);

  /** The offer beside the last thing done, which stands for a few seconds. */
  const [undoable, setUndoable] = useState<{ message: string; revert: () => void } | null>(null);

  const remember = useCallback((entry: { message: string; revert: () => void }) => {
    setUndos((current) => [...current, entry].slice(-UNDO_DEPTH));
    setUndoable(entry);
  }, []);

  /** Takes back the last thing done, wherever the asking came from. */
  const undo = useCallback(() => {
    setUndos((current) => {
      const last = current[current.length - 1];
      if (!last) return current;

      last.revert();
      setUndoable(null);
      return current.slice(0, -1);
    });
  }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergePrimary, setMergePrimary] = useState<string | null>(null);

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

  /*
   * Every day of the trip with the zone it is lived in. Worked out from the
   * journeys recorded, corrected by whatever anyone has fixed by hand, and
   * shared by the views rather than each deciding for itself.
   */
  const slots = useMemo(
    () =>
      daySlots(
        daysInRange(tripRange.start, tripRange.end),
        events,
        homeTimezone,
        doc?.meta?.dayZones,
      ),
    [tripRange, events, homeTimezone, doc?.meta?.dayZones],
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
    const grouped = groupByDay(events, slots, homeTimezone);

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
  }, [events, slots, homeTimezone, view, anchor]);

  /*
   * The map shows the day the list is anchored on, not the whole trip. Pins
   * numbered one to forty across three weeks would say nothing about the order
   * of anything.
   */
  /*
   * Brings the anchored day into view whenever it changes, rather than only
   * changing the map and the label beside the buttons.
   */
  useEffect(() => {
    if (view !== 'day') return;

    const list = dayListRef.current;
    const section = list?.querySelector<HTMLElement>(`[data-day-section="${anchor}"]`);
    if (!list || !section) return;

    /*
     * The list is moved by hand rather than with scrollIntoView. That walks up
     * the ancestors and scrolls whichever ones it can, and the page itself can
     * be scrolled programmatically even though it is set not to -- which
     * carried the app header off the top of the window with no way back.
     */
    list.scrollTop += section.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }, [anchor, view, days.length]);

  /*
   * A week or month click changes views before its event exists in the DOM.
   * Wait for the open editor to be laid out, then centre it inside the list's
   * own scrollport. Using the list directly keeps the app header fixed.
   */
  useEffect(() => {
    const eventId = pendingEventScrollRef.current;
    if (view !== 'day' || !eventId || openEventId !== eventId) return;

    const frame = requestAnimationFrame(() => {
      const list = dayListRef.current;
      const target = document.getElementById(`event-${eventId}`);
      if (!list || !target || !list.contains(target)) return;

      const listBox = list.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const space = Math.max(12, (listBox.height - Math.min(targetBox.height, listBox.height)) / 2);
      list.scrollTop += targetBox.top - listBox.top - space;
      pendingEventScrollRef.current = null;
    });

    return () => cancelAnimationFrame(frame);
  }, [view, openEventId, days.length]);

  /** Everything with no day yet, which the week and month cannot draw. */
  const undated = useMemo(
    () => events.filter((event) => event.startsAt === undefined),
    [events],
  );

  const phone = useMediaQuery(PHONE);

  /*
   * The day the map draws, read the same way the week reads it: by the slot the
   * instant falls in. A flight leaving at 09:00 in Tokyo and the dinner that
   * follows it in Honolulu are one day of the trip, and the map of that day has
   * both pins on it.
   */
  const mappable = useMemo(
    () => events.filter((event) => event.startsAt !== undefined && slotForInstant(slots, event.startsAt) === anchor),
    [events, slots, anchor],
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

  /** Starts a global, unscheduled event and opens its name for editing. */
  function create() {
    if (!store || readOnly) return;
    const id = `e_${randomId()}`;

    store.change((current) => addEvent(current, { id, name: '' }, { userId: 'me' }));
    pendingEventScrollRef.current = id;
    setView('day');
    setHighlighted(id);
    setOpenEventId(id);
  }

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
     * The zone is the day's, not the home one, the same as it is when a card is
     * dragged. A week that crosses into Tokyo draws its Tokyo columns on Tokyo
     * time, so nine on one of them means nine there; making the event on the
     * home clock filed it eight hours from where it was drawn.
     */
    const zone = zoneOfDay(slots, day, homeTimezone);

    /*
     * The minutes come from the grid, which is drawn in the day's own zone --
     * so they are a wall-clock time there, not an offset from midnight UTC.
     * Treating them as the latter put a nine o'clock drag at six in the evening
     * in Tokyo.
     *
     * A tap on a day says nothing about the hour, and the event records that
     * rather than being given one.
     */
    const onThatDay = setDay(undefined, zone, day);
    const minutes = options.startMinutes;
    const startsAt =
      onThatDay === null || minutes === undefined
        ? onThatDay
        : setTimeOfDay(
            onThatDay,
            zone,
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
          timezone: zone,
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

  /**
   * Books somewhere for a run of nights the week had nothing over.
   *
   * `lastNight` is the last night slept there, so checkout is the morning after
   * it — the rail draws a stay up to the night before its checkout day, and a
   * hotel offered for three nights that came back covering two would be wrong
   * in the one place the person was looking.
   *
   * The hours are the same convention the stay editor uses when a date is typed
   * there, so a hotel made here and one made by hand are the same kind of thing.
   */
  function createLodging(firstNight: DayKey, lastNight: DayKey, name: string) {
    if (!store || readOnly) return;

    // Three in the afternoon at the hotel, which is where the first night is
    // spent. Checkout is at the same hotel, so it reads on that clock too even
    // if the trip has moved on by the morning it happens.
    const zone = zoneOfDay(slots, firstNight, homeTimezone);

    const checkInDay = setDay(undefined, zone, firstNight);
    const checkOutDay = setDay(undefined, zone, addDays(lastNight, 1));
    if (checkInDay === null || checkOutDay === null) return;

    const checkIn = setTimeOfDay(checkInDay, zone, '15:00');
    const checkOut = setTimeOfDay(checkOutDay, zone, '10:00');
    if (checkIn === null || checkOut === null) return;

    const id = `e_${randomId()}`;

    store.change((current) => {
      let next = addEvent(current, { id, name }, { userId: 'me' });

      next = updateEvent(
        next,
        id,
        {
          kind: 'lodging',
          lodging: { checkIn, checkOut },
          startsAt: checkIn,
          durationMinutes: Math.round((checkOut - checkIn) / 60_000),
          timezone: zone,
          timeUndecided: undefined,
        },
        { userId: 'me' },
      );

      return next;
    });

    // Stays in the week, where the bar it just made is now drawn.
    setHighlighted(id);
  }

  /**
   * Puts an event on another day and hour, read on that day's own clock.
   *
   * The zone is the day's, not the event's: dropping a card halfway down
   * Thursday means half past two where Thursday is being spent. An event that
   * never named a zone adopts that one, so it keeps reading as the time it was
   * dropped at rather than shifting once the trip moves.
   */
  const moveEventTo = useCallback(
    (eventId: string, day: DayKey, minutes: number) => {
      const event = events.find((candidate) => candidate.id === eventId);
      if (!event) return;

      const zone = zoneOfDay(slots, day, homeTimezone);
      const midnight = setDay(undefined, zone, day);
      if (midnight === null) return;

      const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(
        minutes % 60,
      ).padStart(2, '0')}`;
      const at = setTimeOfDay(midnight, zone, clock);
      if (at === null || at === event.startsAt) return;

      const before = {
        startsAt: event.startsAt,
        timeUndecided: event.timeUndecided,
        timezone: event.timezone,
      };

      store?.change((current) =>
        updateEvent(
          current,
          eventId,
          { startsAt: at, timeUndecided: undefined, timezone: event.timezone ?? zone },
          { userId: 'me' },
        ),
      );

      remember({
        message: `Moved ${event.name || 'the unnamed event'}`,
        revert: () =>
          store?.change((current) => updateEvent(current, eventId, before, { userId: 'me' })),
      });
    },
    [events, slots, homeTimezone, store, remember],
  );

  /*
   * Ctrl+Z, except while typing. A field has its own undo and taking the key
   * from it would make correcting a word revert an event instead.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'z' && event.key !== 'Z') return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      event.preventDefault();
      undo();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

  function goToDay(at: number) {
    const key = slotForInstant(slots, at) ?? dayKey(at, homeTimezone);
    moveAnchor(key);

    // The day may not be on screen yet in week or month view, so move the
    // window first and scroll once React has drawn it.
    requestAnimationFrame(() =>
      document.querySelector(`[data-testid="day-${key}"]`)?.scrollIntoView({ block: 'center' }),
    );
  }

  function focusEvent(eventId: string) {
    const event = events.find((candidate) => candidate.id === eventId);
    const day =
      event?.startsAt === undefined
        ? null
        : (slotForInstant(slots, event.startsAt) ?? eventDay(event, homeTimezone));

    pendingEventScrollRef.current = eventId;
    if (day) moveAnchor(day);
    setView('day');
    setHighlighted(eventId);
    setOpenEventId(eventId);
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
    remember({
      message,
      revert: () =>
        store?.change((current) =>
          ids.reduce((doc, id) => restoreEvent(doc, id, { userId: 'me' }), current),
        ),
    });
  }

  /**
   * Takes a field off an event, with what it holds.
   *
   * The content goes with the field on purpose -- a card that still carries a
   * confirmation code it no longer shows is a document disagreeing with itself,
   * and the code would still be in the export and in search. What was there is
   * read first and handed to the undo offer, which puts it back with the same
   * link and attachment ids rather than as new ones.
   */
  function removeField(eventId: string, key: string, label: string) {
    const event = events.find((candidate) => candidate.id === eventId);
    if (!event) return;

    const held = fieldContents(event, key);
    store?.change((current) => clearField(current, eventId, key, { userId: 'me' }));

    // Also stop asking for it. A field revealed by its chip and then removed
    // would otherwise come straight back as an empty box.
    setRevealedFields((current) => {
      const forEvent = current[eventId];
      if (!forEvent?.has(key)) return current;

      const next = new Set(forEvent);
      next.delete(key);
      return { ...current, [eventId]: next };
    });

    remember({
      message: `Removed ${label}`,
      revert: () => store?.change((current) => restoreField(current, eventId, held, { userId: 'me' })),
    });
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

  /*
   * Opening the month moves the anchor to the middle of the trip, so it draws
   * the month the trip is in rather than the one today happens to fall in.
   */
  function changeView(next: CalendarView) {
    if (next === 'month' && view !== 'month') {
      moveAnchor(middleDay(tripRange.start, tripRange.end));
    }
    setView(next);
  }

  function runCommand(command: CommandId) {
    if (command === 'new-event') {
      create();
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
    <TripChrome
      tripId={tripId ?? ''}
      tripName={trip?.name ?? doc?.meta?.name ?? 'Trip'}
      search={{
        doc,
        homeTimezone,
        onPickEvent: focusEvent,
        onPickDay: goToDay,
        onRunCommand: runCommand,
      }}
      actions={(close) => (
        <PhoneActions
          readOnly={readOnly}
          onCreate={create}
          canShare={trip?.role === 'owner'}
          onShare={share}
          undoLabel={readOnly ? undefined : undos[undos.length - 1]?.message}
          onUndo={undo}
          zonePreference={zonePreference}
          onChangeZone={setZonePreference}
          onDone={close}
        />
      )}
    >
      {/*
        Above the calendar, whose sticky day names and hotel rail sit at 30 and
        would otherwise cut the top off anything opened from this row. Below the
        panels that take the whole screen, which sit at 60.
      */}
      <header className="z-40 shrink-0 border-b border-line bg-page/95 backdrop-blur">
        <div
          data-testid="trip-toolbar"
          className="relative flex w-full flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8"
        >
          {/*
            A phone keeps the name and whether it is saved, and nothing else:
            the rest of this row is in the drawer at the bottom edge, where a
            thumb reaches it. Between the phone and the sidebar's breakpoint
            these links are the only way to the trip's other screens.
          */}
          <div className="flex min-w-0 items-center gap-3">
            {!phone && (
              <Link
                to="/"
                className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
              >
                All trips
              </Link>
            )}
            <h1 className="max-w-48 truncate text-lg xl:max-w-80">{trip?.name ?? 'Trip'}</h1>
            {!phone && (
              <>
                <Link
                  to={`/t/${tripId}/todos`}
                  className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
                >
                  To-dos
                </Link>
                <Link
                  to={`/t/${tripId}/files`}
                  className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
                >
                  Files
                </Link>
                <Link
                  to={`/t/${tripId}/fields`}
                  className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
                >
                  Settings
                </Link>
              </>
            )}
            <SyncBadge state={state} />
          </div>

          {/*
            The one control a phone keeps along the top: which calendar is
            drawn is a question asked constantly, and going through the drawer
            for it would be two taps every time. A letter each, so it fits
            beside the name -- and each is still named Day, Week and Month.
          */}
          {phone && (
            <SegmentedControl
              compact
              className="ml-auto"
              label="Calendar view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={changeView}
            />
          )}
          {/*
            In the flow of the toolbar rather than centred on top of it. While
            it was positioned absolutely it sat over the view switcher, and
            clicks meant for Week or Month landed in the search box instead.
          */}
          <div className="hidden min-w-64 flex-1 justify-center lg:flex">
            <div className="flex w-full max-w-lg">
              <SearchBar
                doc={doc}
                homeTimezone={homeTimezone}
                onPickEvent={focusEvent}
                onPickDay={goToDay}
                onRunCommand={runCommand}
              />
            </div>
          </div>
          {!phone && (
            <div className="ml-auto flex items-center gap-3">
              <SegmentedControl
                label="Calendar view"
                options={VIEW_OPTIONS}
                value={view}
                onChange={changeView}
              />
              {!readOnly && (
                <Button size="sm" variant="primary" onPress={create}>
                  <Plus aria-hidden="true" className="size-4" />
                  Add event
                </Button>
              )}
              <HeaderActions
                canShare={trip?.role === 'owner'}
                zonePreference={zonePreference}
                undoLabel={readOnly ? undefined : undos[undos.length - 1]?.message}
                onUndo={undo}
                onChangeZone={setZonePreference}
                onShare={share}
              />
            </div>
          )}
        </div>

        {/*
          Between the phone and the large breakpoint the search box gets the
          whole row. A phone reaches it through the drawer at the bottom edge
          instead, and this row would be a second copy of the same field.
        */}
        {!phone && (
          <div className="w-full px-4 pb-3 lg:hidden">
            <SearchBar
              doc={doc}
              homeTimezone={homeTimezone}
              onPickEvent={focusEvent}
              onPickDay={goToDay}
              onRunCommand={runCommand}
            />
          </div>
        )}
      </header>

      {/*
        Which calendar is drawn, said on the page itself. The switcher moves
        between the header and the phone's drawer, so it is not always on the
        screen to be read.
      */}
      <main
        data-view={view}
        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6 lg:px-8"
      >
        <div className="shrink-0">
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

        {events.length === 0 && (
          <p className="py-10 text-center text-ink-secondary">
            Nothing here yet. Add the first thing you know about — where you are staying, or the
            flight out.
          </p>
        )}

        <DayNavigator
          view={view}
          anchor={anchor}
          tripStart={tripRange.start}
          tripEnd={tripRange.end}
          onChange={moveAnchor}
        />
        </div>

        {/*
          A column, so the tray of undated events and the calendar divide the
          height between them. Stacked as blocks the calendar still asked for
          all of it, and the tray pushed the bottom of the week -- where the
          hotels are -- past the edge that clips.
        */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {/*
            Everything still waiting for a day. The week and the month are
            drawn from dates, so an event without one was invisible in both --
            the calendar gave no clue that the work was outstanding. Drag one
            onto a day, or open it and pick a date.
          */}
          {view !== 'day' && undated.length > 0 && (
            <div
              data-testid="unscheduled-tray"
              className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line px-2 py-1.5"
            >
              <span className="text-2xs text-ink-muted">
                {undated.length} with no date yet
              </span>

              {undated.slice(0, 6).map((event) => (
                <DraggableEvent key={event.id} id={event.id} disabled={readOnly}>
                  {(handle) => (
                    <button
                      {...handle}
                      type="button"
                      data-testid="unscheduled-item"
                      onClick={() => focusEvent(event.id)}
                      style={coloredSurfaceStyle(event.color)}
                      className="max-w-40 truncate rounded-sm border border-line bg-card px-1.5 py-0.5 text-2xs text-ink hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2"
                    >
                      {event.name || 'Unnamed'}
                    </button>
                  )}
                </DraggableEvent>
              ))}

              {undated.length > 6 && (
                <span className="text-2xs text-ink-muted">+{undated.length - 6} more</span>
              )}
            </div>
          )}

          {view === 'week' && (
            <WeekView
              anchor={anchor}
              tripStart={tripRange.start}
              tripEnd={tripRange.end}
              events={events}
              cityColors={doc?.cityColors}
              homeTimezone={homeTimezone}
              slots={slots}
              onSetDayZone={(day, timezone) =>
                store?.change((current) => setDayZone(current, day, timezone))
              }
              weather={weather}
              today={today}
              readOnly={readOnly}
              onOpenEvent={focusEvent}
              onCreateAt={(day, name, startMinutes, endMinutes) =>
                createOn(day, { startMinutes, endMinutes, name, openAfterCreate: false })
              }
              onCreateLodging={createLodging}
              onMoveEvent={moveEventTo}
            />
          )}

          {view === 'month' && (
            <MonthView
              anchor={anchor}
              tripStart={tripRange.start}
              tripEnd={tripRange.end}
              events={events}
              cityColors={doc?.cityColors}
              homeTimezone={homeTimezone}
              weather={weather}
              today={today}
              readOnly={readOnly}
              onOpenDay={(day) => {
                moveAnchor(day);
                setView('day');
              }}
              onOpenEvent={focusEvent}
              onCreateOn={(day) => createOn(day)}
            />
          )}

          {view === 'day' && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <div
                ref={dayListRef}
                data-testid="day-list-scroll"
                className="min-h-0 min-w-0 flex-1 overflow-y-auto lg:pr-1"
              >
          {days.map(([key, dayEvents]) => (
            <section key={key} data-day-section={key} className="mb-8">
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
                                  className="flex cursor-grab touch-none items-center justify-center px-1 text-ink-placeholder hover:text-ink-muted focus-visible:outline-focus focus-visible:outline-2"
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
                            onToggle={() => {
                              if (openEventId === event.id) setOpenEventId(null);
                              else focusEvent(event.id);
                            }}
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
                            onSetCityColor={(city, color) =>
                              store?.change((current) => setCityColor(current, city, color))
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
                            onAddTodo={(text, deadline) =>
                              store?.change((current) =>
                                addTodo(
                                  current,
                                  event.id,
                                  `todo_${randomId()}`,
                                  { text, deadline },
                                  { userId: 'me' },
                                ),
                              )
                            }
                            onUpdateTodo={(id, patch: Partial<EditableTodo>) =>
                              store?.change((current) =>
                                updateTodo(current, event.id, id, patch, { userId: 'me' }),
                              )
                            }
                            onRemoveTodo={(id) =>
                              store?.change((current) =>
                                removeTodo(current, event.id, id, { userId: 'me' }),
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
                            onRemoveField={(key, label) => removeField(event.id, key, label)}
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
                Beside the timeline from the large breakpoint up, and under it
                between there and a phone. A phone gets no map: it has nowhere
                to put one but under the list, where it would take a third of
                the screen and a screenful of tiles to show pins the cards
                already name. Left out of the tree, so Leaflet never mounts and
                no tile is fetched.
              */}
              {/*
                Takes its space only when there is a pin to put in it. Before
                that the panel is one line, and the itinerary has the width.
              */}
              {!phone && (
                <aside
                  className={
                    mappable.some((event) => event.location?.lat !== undefined)
                      ? 'h-64 shrink-0 lg:h-full lg:w-[26rem] xl:w-[34rem] 2xl:w-[42rem]'
                      : 'shrink-0 lg:w-[26rem] xl:w-[34rem] 2xl:w-[42rem]'
                  }
                >
                  <DayMap
                    events={mappable}
                    selectedId={highlighted}
                    onSelect={focusEvent}
                  />
                </aside>
              )}
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
            dayLabel={formatDayHeading(Date.parse(`${anchor}T12:00:00Z`), 'UTC')}
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
            onUndo={undo}
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

    </TripChrome>
  );
}
