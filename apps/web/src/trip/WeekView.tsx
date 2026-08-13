import type { TripEvent } from '@trip/crdt';
import { StatusSpine, cn, coloredSurfaceStyle } from '@trip/ui';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import {
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { DayKey } from '../lib/calendar';
import {
  addDays,
  clampDay,
  cityDaySegments,
  daysInRange,

  lodgingSpans,
  nightsWithoutLodging,
  spanWithin,
} from '../lib/calendar';
import { eventsBySlot, zoneRuns, type DaySlot, type ZoneRun } from '../lib/dayZones';
import { formatTime, minutesSinceMidnight, timeZoneAbbreviation } from '../lib/time';
import { TimezonePicker } from './TimezonePicker';
import { EventKindIcon } from './EventKind';
import { useCalendarDisplaySettings } from './useCalendarDisplaySettings';
import { useDisplayZone } from './useDisplayZone';
import { weatherGlyph, type DailyWeather } from './useWeather';

/* A calendar hour needs enough room for a readable short event. */
const HOUR_HEIGHT = 56;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
const DEFAULT_EVENT_MINUTES = 30;

/*
 * What a dragged event lands on. Half an hour is the grain a plan is made at --
 * "half two" is a time somebody says, 14:23 is a time they would have to
 * correct -- and it stays legible when a fitted week compresses the hours.
 */
const SNAP_MINUTES = 30;

interface PositionedEvent {
  event: TripEvent;
  top: number | string;
  height: number | string;
  column: number;
  columns: number;
  /** Starts earlier than the week draws, so it sits at the top of the column. */
  outsideBefore: boolean;
  /** Runs past the last hour the week draws, so it stops at the bottom. */
  outsideAfter: boolean;
}

/**
 * Places events in their true time slot and gives overlapping appointments a
 * lane of their own. Without lanes, two 09:00 appointments obscure each
 * other; without absolute positions, a 17:00 appointment reads as though it
 * follows breakfast.
 */
function positionEvents(
  events: TripEvent[],
  columnZone: string,
  windowStart: number,
  windowEnd: number,
  fitToView: boolean,
): PositionedEvent[] {
  const timed = events
    .filter(
      (event): event is TripEvent & { startsAt: number } =>
        event.startsAt !== undefined && !event.timeUndecided,
    )
    .map((event) => {
      /*
       * Measured on the column's clock, not the event's.
       *
       * Two events in different zones used to be laid out against one another
       * as though both were local, so a Tokyo evening and a Honolulu morning
       * that are hours apart could be drawn overlapping. The column is one
       * day in one place; where a card sits in it says when it happens there.
       * The card still prints its own local time, tagged with its own zone.
       */
      const actualStart = minutesSinceMidnight(event.startsAt, columnZone);
      const duration = Math.max(1, event.durationMinutes ?? DEFAULT_EVENT_MINUTES);

      /*
       * Clamped to the visible hours, and never to nothing.
       *
       * The week only draws part of the day, so an 05:30 flight has no slot of
       * its own. Clamping start and end independently inverts them for an
       * event outside the window, and an inverted pair is not drawable, so the
       * flight went missing from the week altogether. Every event keeps at
       * least a sliver, pinned to whichever edge it fell past, and the card
       * still prints its true time. The flags below say which edge it is.
       */
      const actualEnd = actualStart + duration;
      const sliver = Math.min(15, windowEnd - windowStart);
      const start = Math.min(Math.max(actualStart, windowStart), windowEnd - sliver);
      const end = Math.max(Math.min(actualEnd, windowEnd), start + sliver);

      return {
        event,
        start,
        end,
        outsideBefore: actualStart < windowStart,
        outsideAfter: actualEnd > windowEnd,
        column: 0,
        columns: 1,
      };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const positioned: typeof timed = [];
  let group: typeof timed = [];
  let groupEnd = -1;

  function finishGroup() {
    if (group.length === 0) return;
    const columns = Math.max(...group.map((item) => item.column)) + 1;
    for (const item of group) item.columns = columns;
    positioned.push(...group);
    group = [];
    groupEnd = -1;
  }

  for (const item of timed) {
    if (item.start >= groupEnd) finishGroup();

    const occupied = new Set(
      group.filter((candidate) => candidate.end > item.start).map((candidate) => candidate.column),
    );
    while (occupied.has(item.column)) item.column += 1;

    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  finishGroup();

  const visibleMinutes = windowEnd - windowStart;

  return positioned.map((item) => {
    const offset = item.start - windowStart;
    const duration = item.end - item.start;

    return {
      event: item.event,
      top: fitToView ? `${(offset / visibleMinutes) * 100}%` : offset * MINUTE_HEIGHT,
      // A minimum keeps short events usable after a long range is compressed.
      height: fitToView
        ? `max(24px, calc(${(duration / visibleMinutes) * 100}% - 2px))`
        : Math.max(30, duration * MINUTE_HEIGHT - 2),
      column: item.column,
      columns: item.columns,
      outsideBefore: item.outsideBefore,
      outsideAfter: item.outsideAfter,
    };
  });
}

/**
 * A multi-day stay whose identity follows the visible part of its bar.
 *
 * The label is sticky inside the stay rather than fixed to the viewport, so it
 * can never escape the dates the hotel covers. When less than one natural
 * label-width remains visible, hiding it is clearer than showing a clipped
 * fragment that looks like a second, tiny stay.
 */
function WeekLodging({
  event,
  gridColumn,
  scroller,
  onOpen,
}: {
  event: TripEvent;
  gridColumn: string;
  scroller: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}) {
  const bar = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const [showLabel, setShowLabel] = useState(true);

  useEffect(() => {
    const viewport = scroller.current;
    const barElement = bar.current;
    const labelElement = label.current;
    if (!viewport || !barElement || !labelElement) return;

    const measure = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const barRect = barElement.getBoundingClientRect();
      // The first 2.5rem is the sticky time-axis gutter, not usable rail.
      const visibleStart = viewportRect.left + RAIL_PIXELS;
      const visibleWidth = Math.max(
        0,
        Math.min(barRect.right, viewportRect.right) - Math.max(barRect.left, visibleStart),
      );
      const startsOffscreen = barRect.left < visibleStart;
      const enoughRoom = visibleWidth >= labelElement.offsetWidth;
      setShowLabel(!startsOffscreen || enoughRoom);
    };

    measure();
    viewport.addEventListener('scroll', measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    resize.observe(barElement);
    resize.observe(labelElement);

    return () => {
      viewport.removeEventListener('scroll', measure);
      resize.disconnect();
    };
  }, [scroller]);

  return (
    <button
      ref={bar}
      type="button"
      data-testid="week-lodging"
      onClick={onOpen}
      style={{
        ...coloredSurfaceStyle(event.color),
        gridColumn,
        gridRow: 1,
      }}
      className={cn(
        'min-w-0 rounded-full border border-line-default bg-sunken text-left text-2xs text-ink',
        'hover:bg-card focus-visible:outline-focus focus-visible:outline-2',
      )}
    >
      <span
        ref={label}
        data-testid="week-lodging-label"
        data-visible={showLabel ? 'true' : 'false'}
        className={cn(
          'sticky flex w-max max-w-[calc(100%-1rem)] items-center gap-1.5 px-2 py-1',
          'transition-opacity duration-100',
          showLabel ? 'opacity-100' : 'opacity-0',
        )}
        // Clear of the rail, whatever the rail is worth. It was written in as
        // two and a half rem, and widening the rail slid the name under it.
        style={{ left: `calc(${RAIL_WIDTH} + 0.5rem)` }}
      >
        <StatusSpine
          status={event.booking.status}
          orientation="horizontal"
          className="w-4 shrink-0"
        />
        <EventKindIcon kind={event.kind} className="size-3 shrink-0 text-ink-muted" />
        <span className="truncate">{event.name}</span>
      </span>
    </button>
  );
}

export interface WeekViewProps {
  anchor: DayKey;
  tripStart: DayKey;
  tripEnd: DayKey;
  events: TripEvent[];
  cityColors?: Record<string, string>;
  homeTimezone: string;
  /**
   * Every day of the trip with the zone it is lived in, in order.
   *
   * Worked out from the journeys rather than assumed, so a week that crosses
   * zones draws each day on the clock of the place it happens in.
   */
  slots: DaySlot[];
  /** Fixes a day's zone by hand, or hands it back to be worked out. */
  onSetDayZone: (day: DayKey, timezone: string | undefined) => void;
  weather: Map<DayKey, DailyWeather>;
  today: DayKey;
  readOnly: boolean;
  onOpenEvent: (eventId: string) => void;
  /**
   * Makes an event on that day, over that time when a drag said one.
   *
   * A tap says which day and nothing else, which is a state the event can hold
   * now rather than a reason to invent an hour for it.
   */
  onCreateAt: (day: DayKey, name: string, startMinutes?: number, endMinutes?: number) => void;
  /**
   * Makes a stay covering every night from `from` to `to` inclusive.
   *
   * `to` is the last night rather than the checkout day, the same way a stay is
   * drawn, so the caller is the one that decides checkout is the morning after.
   */
  onCreateLodging: (from: DayKey, to: DayKey, name: string) => void;
  /**
   * Moves a timed event to another day and hour, on that day's own clock.
   *
   * `minutes` is from the target day's midnight, snapped to the half hour --
   * close enough to place a plan, coarse enough that a hand that wobbles by a
   * pixel does not write 14:07.
   */
  onMoveEvent: (eventId: string, day: DayKey, minutes: number) => void;
}

function InlineEventDraft({
  name,
  label = 'Event name',
  onChange,
  onCommit,
  onCancel,
  className,
  style,
}: {
  name: string;
  /** What is being named, since the rail asks for a hotel and a column an event. */
  label?: string;
  onChange: (name: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-testid="week-event-draft"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'z-10 flex min-w-0 items-start rounded-sm border border-dashed border-accent bg-accent-soft px-1 py-1',
        className,
      )}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) onCommit();
            if (event.key === 'Escape') onCancel();
          }}
          onBlur={() => (name.trim() ? onCommit() : onCancel())}
          placeholder={label}
          className="h-6 w-full min-w-0 rounded-sm border-0 bg-card/80 px-1 text-xs text-ink outline-none placeholder:text-ink-placeholder focus:ring-2 focus:ring-accent"
        />
      </label>
    </div>
  );
}

/**
 * The width of one day, shared by every row so the columns line up.
 *
 * Seven fit the view at the width the trip is usually read at, and a day never
 * goes below the width its date needs. Each run of days adds a rail of its own,
 * which the subtraction below does not try to account for: the alternative is
 * columns that change width as the trip crosses a zone.
 */
const COLUMN_WIDTH = 'max(6.5rem, calc((100cqw - 3.25rem - 7px) / 7))';

/*
 * Wide enough for "09:00" with air on both sides. At the old width the numbers
 * were pressed against the first column of the run, and a trip changing zone
 * every day drew that seam three times across one screen.
 */
const RAIL_WIDTH = '3.25rem';

/** The same width in pixels, for the measuring the lodging label does. */
const RAIL_PIXELS = 52;

/** The gutter before a run's rail, so one run reads as ending and another beginning. */
const RUN_GAP = '0.75rem';

/**
 * One row of the week, drawn run by run with a rail in front of each.
 *
 * The rail is a flex child of its run rather than a cell of one big grid, and
 * that is what lets it stick. A sticky box may only travel inside its own
 * containing block: as a grid item that is the one cell it occupies, so it has
 * nowhere to go, while as a flex child of the run it may travel the run's whole
 * width -- held at the left edge for as long as those days are on screen, and
 * pushed off by the run that follows.
 *
 * The other half of it is that the whole week is one scroller. Sticky resolves
 * against the nearest ancestor that scrolls, so while the timetable scrolled
 * vertically on its own, every rail inside it was pinned to a box that never
 * moved sideways.
 */
function RunRows({
  runs,
  className,
  rowClassName,
  testId,
  rail,
  children,
}: {
  runs: ZoneRun[];
  className?: string;
  /** Applied to each run's grid of days. */
  rowClassName?: string;
  testId?: string;
  rail: (run: ZoneRun) => React.ReactNode;
  children: (run: ZoneRun) => React.ReactNode;
}) {
  return (
    <div className={cn('flex', className)} data-testid={testId}>
      {runs.map((run, index) => (
        <section
          key={`${run.zone}:${run.days[0]!.day}`}
          data-week-run={run.days[0]!.day}
          data-zone={run.zone}
          className="flex min-w-0"
        >
          {/*
            The line is what separates the hours from the day beside them. Space
            alone left the numbers reading as though they belonged to the first
            column, and every run of days repeated that ambiguity.
          */}
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-line bg-page"
            style={{ width: RAIL_WIDTH }}
          >
            {rail(run)}
          </div>
          <div
            className={cn('grid gap-px', rowClassName)}
            style={{ gridTemplateColumns: `repeat(${run.days.length}, ${COLUMN_WIDTH})` }}
          >
            {children(run)}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Which clock a run of days is on, over its hours.
 *
 * Short, because it sits in a rail two and a half characters wide. The full
 * zone name is in the title, and the marker says the zone was set by hand
 * rather than worked out from the journeys.
 */
function ZoneTag({
  zone,
  at,
  overridden,
  readOnly,
  onChange,
}: {
  zone: string;
  at: number;
  overridden: boolean;
  readOnly: boolean;
  onChange: (timezone: string | undefined) => void;
}) {
  const label = `${timeZoneAbbreviation(at, zone)}${overridden ? '*' : ''}`;

  if (readOnly) {
    return (
      <span
        data-testid="week-zone-tag"
        data-zone={zone}
        title={zone}
        className="truncate text-2xs font-medium text-ink-muted"
      >
        {label}
      </span>
    );
  }

  return (
    <span
      data-testid="week-zone-tag"
      data-zone={zone}
      data-overridden={overridden ? 'true' : 'false'}
      title={
        overridden
          ? `${zone}, set by hand. Press to change it, or set it back to the flights.`
          : `${zone}, from the flights on this trip. Press to set it by hand.`
      }
      className={cn('flex min-w-0 items-center', overridden && 'text-accent-text')}
    >
      <TimezonePicker
        value={zone}
        at={at}
        label={`Zone for these days: ${label}`}
        onChange={(next) =>
          /*
           * Choosing the zone it already had means "stop correcting this" --
           * the days go back to following the journeys, which is otherwise a
           * state with no way back to it.
           */
          onChange(overridden && next === zone ? undefined : next)
        }
      />
    </span>
  );
}

/** "12 to 16 August", for saying which nights an offer would cover. */
function nightsLabel(from: DayKey, to: DayKey): string {
  const month = (day: DayKey) =>
    new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
      Date.parse(`${day}T12:00:00Z`),
    );

  const dayOf = (day: DayKey) => Number(day.slice(8));

  if (from === to) return `${dayOf(from)} ${month(from)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayOf(from)} to ${dayOf(to)} ${month(to)}`;

  return `${dayOf(from)} ${month(from)} to ${dayOf(to)} ${month(to)}`;
}

/**
 * One night with nowhere to sleep, offered on its own.
 *
 * Dotted rather than solid, because it stands for something that is not there
 * yet. There is one of these per empty night rather than one per stretch of
 * them: a press books the night it is on, and dragging along the rail books
 * every night the drag covers, the same gesture the columns above use to make
 * an event over a stretch of hours.
 */
function AddLodging({
  day,
  column,
  selected,
  onPress,
  onEnter,
  onTap,
}: {
  day: DayKey;
  column: number;
  selected: boolean;
  onPress: (touch: boolean) => void;
  onEnter: () => void;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="week-add-lodging"
      data-day={day}
      data-selected={selected ? 'true' : 'false'}
      /*
       * A mouse press starts a drag here rather than waiting for a click, so
       * the one press can run along the rail and pick several nights.
       *
       * A finger cannot: dragging along the rail and scrolling the week
       * sideways are the same gesture, and taking it for booking would make
       * the week unscrollable wherever a night is free. A tap still books,
       * through the click below, which the browser withholds if the touch
       * turned out to be a scroll.
       */
      onPointerDown={(event) => {
        const touch = event.pointerType === 'touch';
        if (!touch) event.preventDefault();
        onPress(touch);
      }}
      onPointerEnter={onEnter}
      onClick={onTap}
      aria-label={`Add a hotel for the night of ${nightsLabel(day, day)}`}
      style={{ gridColumn: column, gridRow: 1 }}
      className={cn(
        '@container min-w-0 rounded-full border border-dotted text-left text-2xs',
        'focus-visible:outline-focus focus-visible:outline-2',
        // Stronger than the solid bars beside it, because a dotted line of the
        // same weight all but disappears against the page.
        selected
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line-strong text-ink-muted hover:border-accent hover:bg-sunken hover:text-ink',
      )}
    >
      <span className="flex w-full items-center justify-center gap-1.5 px-2 py-1 @min-[5rem]:justify-start">
        <Plus className="size-3 shrink-0" />
        {/* Only where the column is wide enough to read it. A day this narrow
            shows the mark alone rather than a clipped word. */}
        <span className="hidden truncate @min-[5rem]:inline">Add hotel</span>
      </span>
    </button>
  );
}

/**
 * One day's column: the drop target, the drag surface, and the list, as one
 * element.
 *
 * They were three nested divs, and the outer one was tall while the one
 * carrying the identity was as short as its contents -- so a press aimed at the
 * column by its name landed above it. One element cannot disagree with itself.
 */
function DayColumn({
  day,
  children,
  disabled,
  selected,
  onStart,
  onMove,
  onFinish,
  onAdd,
  band,
  windowStart,
  windowEnd,
  fitToView,
}: {
  day: DayKey;
  children: React.ReactNode;
  disabled: boolean;
  selected: boolean;
  onStart: (minutes: number) => void;
  onMove: (minutes: number) => void;
  onFinish: () => void;
  /** Adds to this day with no hour, for a pointer that cannot drag one out. */
  onAdd: () => void;
  band: { top: number | string; height: number | string } | null;
  windowStart: number;
  windowEnd: number;
  fitToView: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, disabled });

  /*
   * Where in the day the pointer is, to the nearest quarter hour. Snapping is
   * what makes a dragged-out time land on 09:15 rather than 09:13, which is
   * the difference between a time somebody would type and one they would have
   * to correct.
   */
  function minutesAt(e: React.PointerEvent<HTMLDivElement>): number {
    const bounds = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - bounds.top;
    const minutes =
      windowStart + Math.round(((y / bounds.height) * (windowEnd - windowStart)) / 15) * 15;

    return Math.max(windowStart, Math.min(windowEnd, minutes));
  }

  return (
    <div
      ref={setNodeRef}
      data-testid={`day-${day}`}
      // Read by a drag looking for the column under the pointer, which the
      // test id would also answer to -- but that is a name for a test to use,
      // not a thing for the view to depend on.
      data-week-column={day}
      onPointerDown={(e) => {
        /*
         * Anywhere in the column except on an event. A press that started on
         * one belongs to it, and stealing that would stop it opening.
         */
        if (disabled) return;
        if ((e.target as HTMLElement).closest('[data-testid="week-event"]')) return;

        /*
         * Not on touch. Dragging down a column and scrolling the day are the
         * same gesture with a finger, and taking it for creation would make the
         * week unscrollable. A tap on an empty day and a tap on a month cell
         * both create, so nothing is out of reach there.
         */
        if (e.pointerType === 'touch') return;

        e.currentTarget.setPointerCapture(e.pointerId);
        onStart(minutesAt(e));
      }}
      onPointerMove={(e) => onMove(minutesAt(e))}
      onPointerUp={onFinish}
      className={cn(
        /*
         * The grid is the sheet the day is written on, so it sits a step below
         * the cards drawn on it. Holding the column at the card surface made an
         * event with no colour the same colour as the hour behind it, and only
         * its border said where it started.
         */
        'relative block min-w-0 bg-page',
        isOver && 'bg-accent-soft',
        selected && 'bg-accent-soft',
        !disabled && 'cursor-cell',
      )}
      style={{
        height: fitToView ? '100%' : (windowEnd - windowStart) * MINUTE_HEIGHT,
        // The subtle border is one step off the page grey, which is too little to
        // see an hour by. The default border is the next step out.
        backgroundImage:
          'linear-gradient(to bottom, transparent calc(100% - 1px), var(--border-default) 1px)',
        backgroundSize: fitToView
          ? `100% ${100 / ((windowEnd - windowStart) / 60)}%`
          : `100% ${HOUR_HEIGHT}px`,
      }}
    >
      {/*
        Dragging out a time is a mouse gesture: with a finger the same movement
        scrolls the week, so it is left alone there. This is what a finger gets
        instead, and it says which day without pretending to know the hour.
      */}
      {!disabled && (
        <button
          type="button"
          data-testid={`week-add-${day}`}
          /*
           * The press belongs to the button, not to the column behind it.
           * Letting it through started a drag at the button's own position --
           * the bottom of the column -- so tapping Add made an event at 23:15.
           */
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Add something on ${day}`}
          onClick={onAdd}
          className="absolute inset-x-0.5 bottom-0.5 z-10 hidden rounded-sm border border-dashed border-line py-0.5 text-2xs text-ink-muted [@media(pointer:coarse)]:block"
        >
          Add
        </button>
      )}

      {/* What the drag has picked so far, so the gesture shows its result. */}
      {band && (
        <div
          aria-hidden="true"
          style={{ top: band.top, height: band.height }}
          className="pointer-events-none absolute inset-x-0.5 rounded-sm border border-accent bg-accent-soft/70"
        />
      )}

      {children}
    </div>
  );
}

/**
 * A week, with where you are sleeping along the bottom.
 *
 * The lodging rail is the point of this view. Each hotel is one continuous bar
 * across the nights it covers, so "Kyoto Monday to Thursday, Osaka Thursday to
 * Sunday" reads without looking at a single event — which is the question a
 * week of a trip is usually being opened to answer.
 */
export function WeekView({
  anchor,
  tripStart,
  tripEnd,
  events,
  cityColors,
  homeTimezone,
  slots,
  onSetDayZone,
  weather,
  today,
  readOnly,
  onOpenEvent,
  onCreateAt,
  onCreateLodging,
  onMoveEvent,
}: WeekViewProps) {
  const days = useMemo(() => daysInRange(tripStart, tripEnd), [tripStart, tripEnd]);
  const displaySettings = useCalendarDisplaySettings();
  const windowStart = displaySettings.weekStartHour * 60;
  const windowEnd = displaySettings.weekEndHour * 60;
  const timetableHeight = (windowEnd - windowStart) * MINUTE_HEIGHT;
  const horizontalScroller = useRef<HTMLDivElement>(null);

  /*
   * The week is drawn one run of days at a time, a run being the days that
   * share a clock. Each run carries its own hours down the left, which is the
   * only honest way to draw a week that changes zone halfway: one rail would
   * be labelled for a place half the columns are not in.
   *
   * The rail sticks to the left edge while its own run is on screen and is
   * pushed off by the next one, so scrolling across a trip hands over from one
   * clock to the next at the day the trip moved.
   */
  const runs = useMemo(() => zoneRuns(slots), [slots]);
  const zoneOfDay = useMemo(() => {
    const byDay = new Map<DayKey, string>();
    for (const slot of slots) byDay.set(slot.day, slot.zone);
    return (day: DayKey) => byDay.get(day) ?? homeTimezone;
  }, [slots, homeTimezone]);

  /*
   * The whole trip is one finite strip. Moving the anchor only brings its
   * already-rendered cell to the left edge; it never replaces dates behind the
   * scrollbar, so the thumb truthfully represents start-to-end progress.
   */
  useLayoutEffect(() => {
    const scroller = horizontalScroller.current;
    const target = clampDay(anchor, tripStart, tripEnd);
    const cell = scroller?.querySelector<HTMLElement>(`[data-week-day="${target}"]`);
    if (!scroller || !cell) return;

    const gutterWidth = 40;
    const nextScrollLeft =
      scroller.scrollLeft +
      cell.getBoundingClientRect().left -
      scroller.getBoundingClientRect().left -
      gutterWidth -
      1;
    scroller.scrollLeft = nextScrollLeft;
  }, [anchor, tripEnd, tripStart]);

  /*
   * Which days are being dragged across.
   *
   * A press picks the first day and moving picks the last, so a drag says both
   * when something starts and how long it goes on -- which is the whole reason
   * to drag rather than click. Held here rather than in the document: an
   * in-progress gesture is nobody else's business until it is finished.
   */
  const [drag, setDrag] = useState<{ day: DayKey; from: number; to: number } | null>(null);
  const [creating, setCreating] = useState<{
    day: DayKey;
    start?: number;
    end?: number;
    name: string;
  } | null>(null);

  /**
   * The nights being dragged over in the rail.
   *
   * `anchor` is where the press landed and stays put; `from` and `to` are what
   * has been picked so far, already held in order and already kept inside the
   * run of empty nights the press started in.
   */
  const [bedDrag, setBedDrag] = useState<{
    anchor: DayKey;
    from: DayKey;
    to: DayKey;
  } | null>(null);

  /** The run of empty nights being named, once a drag has finished on it. */
  const [bedDraft, setBedDraft] = useState<{ from: DayKey; to: DayKey; name: string } | null>(null);

  /**
   * Whether the press the next click belongs to came from a mouse.
   *
   * A mouse press is already a drag by the time its click arrives, so the
   * click has nothing left to do. A tap never started one, so its click is
   * what books the night. Set on every press, which is what keeps the answer
   * about the press the click actually follows.
   */
  const bedPressWasMouse = useRef(false);

  /*
   * The drag ends wherever the pointer is let go, not only over a night.
   *
   * Someone picking the last few nights of a week runs off the end of the rail
   * as often as not, and a release the rail never hears about would leave the
   * selection stuck to the pointer with nothing to end it.
   */
  useEffect(() => {
    if (!bedDrag) return;

    const finish = () => {
      setBedDraft({ from: bedDrag.from, to: bedDrag.to, name: '' });
      setBedDrag(null);
    };

    // A cancelled pointer is the system taking the gesture away -- a scroll
    // that turned out to be a scroll -- so it picks nothing.
    const abandon = () => setBedDrag(null);

    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', abandon);

    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', abandon);
    };
  }, [bedDrag]);

  const selecting = drag
    ? {
        day: drag.day,
        start: Math.min(drag.from, drag.to),
        // A press with no travel still means something: half an hour from
        // there, which is the commonest thing to want and easy to change.
        end: Math.max(drag.from, drag.to, Math.min(drag.from, drag.to) + DEFAULT_EVENT_MINUTES),
      }
    : null;

  /**
   * An event being carried to another time, and where it would land.
   *
   * `grab` is how far down the card the press was, so the card keeps the
   * position under the hand rather than jumping its top to the pointer.
   * `travelled` is what tells a move from a click: a press that never went
   * anywhere is somebody opening the event.
   */
  const [carry, setCarry] = useState<{
    id: string;
    minutes: number;
    length: number;
    day: DayKey;
    grab: number;
    travelled: boolean;
  } | null>(null);

  /*
   * Held in a ref as well, because the click that follows a drag arrives after
   * the state has been cleared and has to be swallowed: releasing the card
   * would otherwise both move the event and open it.
   */
  const dropped = useRef(false);

  useEffect(() => {
    if (!carry) return;

    /** Where the pointer is, as a day of the week and a half hour of that day. */
    function readPosition(at: PointerEvent): { day: DayKey; minutes: number } | null {
      const under = document
        .elementFromPoint(at.clientX, at.clientY)
        ?.closest<HTMLElement>('[data-week-column]');
      if (!under?.dataset.weekColumn) return null;

      const bounds = under.getBoundingClientRect();
      const span = windowEnd - windowStart;
      const top = at.clientY - bounds.top - carry!.grab;
      const minutes = windowStart + Math.round((top / bounds.height) * span / SNAP_MINUTES) * SNAP_MINUTES;

      return {
        day: under.dataset.weekColumn,
        minutes: Math.max(windowStart, Math.min(windowEnd - SNAP_MINUTES, minutes)),
      };
    }

    function move(at: PointerEvent) {
      const position = readPosition(at);
      if (!position) return;

      setCarry((current) =>
        current === null
          ? current
          : {
              ...current,
              day: position.day,
              minutes: position.minutes,
              travelled:
                current.travelled ||
                position.day !== current.day ||
                position.minutes !== current.minutes,
            },
      );
    }

    function drop() {
      setCarry((current) => {
        if (current?.travelled) {
          dropped.current = true;
          onMoveEvent(current.id, current.day, current.minutes);
        }
        return null;
      });
    }

    // The system taking the gesture away leaves the event where it was.
    const abandon = () => setCarry(null);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', abandon);

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', abandon);
    };
  }, [carry, onMoveEvent, windowStart, windowEnd]);

  function finishDrag() {
    if (selecting) setCreating({ ...selecting, name: '' });
    setDrag(null);
  }

  /** A stretch of a day as the band that draws it, fitted or scrolling. */
  function landing(
    span: { start: number; end: number } | null,
  ): { top: number | string; height: number | string } | null {
    if (!span) return null;

    const visible = windowEnd - windowStart;
    const end = Math.min(span.end, windowEnd);

    return displaySettings.weekFitToView
      ? {
          top: `${((span.start - windowStart) / visible) * 100}%`,
          height: `${((end - span.start) / visible) * 100}%`,
        }
      : {
          top: (span.start - windowStart) * MINUTE_HEIGHT,
          height: (end - span.start) * MINUTE_HEIGHT,
        };
  }

  function commitCreation() {
    if (!creating) return;

    const name = creating.name.trim();
    if (!name) return;

    onCreateAt(creating.day, name, creating.start, creating.end);
    setCreating(null);
  }

  function commitLodging() {
    if (!bedDraft) return;

    const name = bedDraft.name.trim();
    if (!name) return;

    onCreateLodging(bedDraft.from, bedDraft.to, name);
    setBedDraft(null);
  }

  /**
   * Widens the drag to take in another night, as far as it may go.
   *
   * A drag is held inside the run of empty nights it began in, so passing over
   * a hotel that is already booked stops at it rather than jumping the gap and
   * offering to book a second bed for nights that have one.
   */
  function dragOver(day: DayKey) {
    setBedDrag((current) => {
      if (!current) return current;

      const run = empties.find((gap) => current.anchor >= gap.from && current.anchor <= gap.to);
      if (!run) return current;

      const reach = day < run.from ? run.from : day > run.to ? run.to : day;

      return {
        anchor: current.anchor,
        from: reach < current.anchor ? reach : current.anchor,
        to: reach > current.anchor ? reach : current.anchor,
      };
    });
  }
  /*
   * Bucketed by slot rather than by each event's own zone. A slot runs from its
   * own midnight to the next one's, so a travel day that gains hours holds
   * everything that happens before the next morning -- including the evening
   * that is already tomorrow where it is being spent.
   */
  const calendarByDay = eventsBySlot(
    events.filter((event) => event.kind !== 'lodging'),
    slots,
  );
  const displayZone = useDisplayZone();

  /**
   * The clock a column is drawn on.
   *
   * Somebody who has asked to see the trip in their own zone has asked for one
   * clock throughout, which is the whole point of that setting: it answers
   * "what time is it there for me", and per-day zones would take that away.
   */
  const columnZone = (slotZone: string) => displayZone(slotZone, slotZone);

  /** Whether an event's own clock differs from the column it is drawn in. */
  const foreignZone = (event: TripEvent, slotZone: string) =>
    displayZone(event.timezone, homeTimezone) !== columnZone(slotZone);
  const citiesByDay = cityDaySegments(events, days, homeTimezone);
  const hasCities = Array.from(citiesByDay.values()).some((bands) => bands.length > 0);
  const beds = lodgingSpans(events, homeTimezone).filter((span) => spanWithin(span, days));

  /*
   * The empty nights twice over: as runs, which is what holds a drag inside the
   * stretch it started in, and one by one, which is what the rail draws.
   */
  const empties = nightsWithoutLodging(beds, days);

  const emptyNights = empties.flatMap((gap) =>
    days.slice(gap.start, gap.start + gap.length).map((day) => ({ day })),
  );

  // Split off the ones on a day but not at an hour. They belong to the day and
  // to no point in it, so they get a row of their own above the grid.
  const untimed = new Map<DayKey, TripEvent[]>();
  for (const day of days) {
    const waiting = (calendarByDay.get(day) ?? []).filter((event) => event.timeUndecided);
    if (waiting.length > 0) untimed.set(day, waiting);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="group"
      aria-label="Week view"
      // A drag that ends outside the grid is abandoned rather than left armed.
      onPointerLeave={() => setDrag(null)}
    >
      {/*
        One scroller for both directions, which is what makes the rails work.
        The hours used to have a scroller of their own for the vertical, and a
        sticky box is measured against the nearest ancestor that scrolls -- so
        every rail inside it was stuck to something that never moved sideways.
        Here the dates stick to the top, the rails to the left, and the beds to
        the bottom, all against this one box.
      */}
      <div
        ref={horizontalScroller}
        data-testid="week-horizontal-scroll"
        tabIndex={0}
        className={cn(
          'min-h-0 flex-1 overflow-x-auto overscroll-x-contain',
          displaySettings.weekFitToView
            ? 'overflow-y-hidden'
            : 'overflow-y-auto overscroll-y-contain',
        )}
        style={{ containerType: 'inline-size' }}
      >
        <div
          className={cn(
            'flex w-max min-w-full flex-col',
            // Fitted, the week is exactly as tall as the box; otherwise it is
            // as tall as its hours and this scroller takes up the difference.
            displaySettings.weekFitToView && 'h-full',
          )}
        >
          {/*
            The city, date and untimed rows travel with the days sideways and
            hold their place while the hours scroll under them.
          */}
          <div className="sticky top-0 z-30 shrink-0 bg-page">
            {hasCities && (
              <RunRows runs={runs} className="pb-1" rail={() => null}>
                {(run) =>
                  run.days.map(({ day }) => {
                  const bands = citiesByDay.get(day) ?? [];
                  const previousCity = citiesByDay.get(addDays(day, -1))?.at(-1)?.label;

                  return (
                    <div
                      key={day}
                      data-week-city-day={day}
                      className="flex min-h-5 min-w-0 overflow-hidden rounded-sm text-2xs font-medium"
                    >
                      {bands.map((band) => {
                        const namesThisBand =
                          band.fromMinute > 0 || day === tripStart || previousCity !== band.label;

                        return (
                          <div
                            key={`${band.label}:${band.fromMinute}`}
                            data-testid="week-city-band"
                            data-city={band.label}
                            data-from-minute={band.fromMinute}
                            data-to-minute={band.toMinute}
                            style={{
                              flexBasis: 0,
                              flexGrow: band.toMinute - band.fromMinute,
                              ...coloredSurfaceStyle(cityColors?.[band.label]),
                            }}
                            className={cn(
                              'min-w-0 truncate px-1 py-0.5',
                              cityColors?.[band.label]
                                ? undefined
                                : 'bg-accent-soft text-accent-text',
                            )}
                          >
                            {namesThisBand ? band.label : '\u00a0'}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
                }
              </RunRows>
            )}

            <RunRows
              runs={runs}
              className="rounded-t-lg border border-line bg-line"
              rowClassName="bg-line"
              rail={(run) => (
                <div className="flex h-full items-center justify-center bg-page px-1 py-1.5">
                  <ZoneTag
                    zone={run.zone}
                    at={run.days[0]!.startsAt}
                    overridden={run.days[0]!.overridden}
                    readOnly={readOnly}
                    /*
                     * Written on the first day of the run, because a correction
                     * carries forward: it says where the trip is from that
                     * morning until a recorded arrival says otherwise. Writing
                     * it on every day of the run would freeze days the flights
                     * are still entitled to speak for.
                     */
                    onChange={(timezone) => onSetDayZone(run.days[0]!.day, timezone)}
                  />
                </div>
              )}
            >
              {(run) =>
                run.days.map((slot) => {
                const { day } = slot;
                const forecast = weather.get(day);
                const glyph = forecast ? weatherGlyph(forecast.code) : null;

                return (
                  <div
                    key={day}
                    data-week-day={day}
                    className="group/day relative min-w-0 bg-card px-1.5 py-2 text-center"
                  >
                    {/*
                      Where the trip moves, said on the day it moves. A zone set
                      here holds from this morning on, so a trip whose flights
                      are not all typed in can still be told where it is -- once
                      per leg rather than once per day.
                    */}
                    {!readOnly && (
                      <span
                        className={cn(
                          'absolute top-0.5 right-0.5 z-10 flex min-w-0 items-center',
                          // Hidden until asked for. The run's rail already says
                          // which clock these days are on, and a chip sitting
                          // over every date would cover the dates to repeat it.
                          'opacity-0 transition-opacity group-hover/day:opacity-100 focus-within:opacity-100',
                        )}
                      >
                        <ZoneTag
                          zone={slot.zone}
                          at={slot.startsAt}
                          overridden={slot.overridden}
                          readOnly={false}
                          onChange={(timezone) => onSetDayZone(day, timezone)}
                        />
                      </span>
                    )}
                    <div
                      className={cn(
                        'text-2xs',
                        day === today ? 'font-semibold text-now-text' : 'text-ink-muted',
                      )}
                    >
                      {new Intl.DateTimeFormat('en-GB', {
                        weekday: 'short',
                        timeZone: 'UTC',
                      }).format(Date.parse(`${day}T12:00:00Z`))}
                    </div>
                    <div
                      className={cn(
                        'tabular text-sm',
                        day === today ? 'font-semibold text-now-text' : 'text-ink',
                      )}
                    >
                      {Number(day.slice(8))}
                    </div>
                    {glyph && forecast && (
                      <div
                        className="truncate text-2xs text-ink-muted"
                        title={
                          forecast.place ? `${glyph.label} in ${forecast.place}` : glyph.label
                        }
                      >
                        <span aria-hidden="true">{glyph.icon}</span>{' '}
                        <span className="tabular hidden sm:inline">
                          {Math.round(forecast.max)}°/{Math.round(forecast.min)}°
                        </span>
                        {/* Which city these numbers are for. A trip moves, and
                            a temperature with no place on it is a guess. */}
                        {forecast.place && (
                          <span className="sr-only"> in {forecast.place}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
              }
            </RunRows>

            {/*
              Events on a day with no hour yet, above the hours rather than in
              them. Drawing one at midnight would put a "Thursday, some time"
              plan at the top of the grid as though that were the plan.
            */}
            {(untimed.size > 0 || (creating && creating.start === undefined)) && (
              <RunRows
                runs={runs}
                className="border-x border-line bg-line"
                rowClassName="bg-line"
                rail={() => (
                  <div className="bg-page py-1 pr-2 text-right text-2xs text-ink-muted">Any</div>
                )}
              >
                {(run) =>
                  run.days.map(({ day }) => (
                  <div key={day} className="flex min-w-0 flex-col gap-0.5 bg-page p-0.5">
                    {creating?.day === day && creating.start === undefined && (
                      <InlineEventDraft
                        name={creating.name}
                        onChange={(name) =>
                          setCreating((current) => (current ? { ...current, name } : current))
                        }
                        onCommit={commitCreation}
                        onCancel={() => setCreating(null)}
                      />
                    )}
                    {(untimed.get(day) ?? []).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        data-testid="week-untimed-event"
                        onClick={() => onOpenEvent(event.id)}
                        style={coloredSurfaceStyle(event.color)}
                        className="flex gap-1 overflow-hidden rounded-sm border border-dashed border-line bg-card px-1 py-0.5 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2"
                      >
                        <StatusSpine status={event.booking.status} />
                        <EventKindIcon
                          kind={event.kind}
                          className="size-3 shrink-0 text-ink-muted"
                        />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-xs',
                            event.name ? 'text-ink' : 'text-ink-placeholder italic',
                          )}
                        >
                          {event.name || 'Unnamed'}
                        </span>
                      </button>
                    ))}
                  </div>
                  ))
                }
              </RunRows>
            )}
          </div>

          {/*
            The hours. No scroller of its own: it is as tall as it needs to be
            and the week's one scroller carries it, which is what leaves the
            rails free to stick to that scroller's left edge.
          */}
          <div
            data-testid="week-timetable"
            className={cn(
              'min-h-0 rounded-b-lg border-x border-b border-line',
              displaySettings.weekFitToView && 'flex-1',
            )}
            style={
              displaySettings.weekFitToView ? undefined : { height: timetableHeight }
            }
          >
            <RunRows
              runs={runs}
              className="h-full"
              rowClassName="h-full bg-line"
              rail={() => (
                <div
                  aria-hidden="true"
                  className="relative h-full bg-page text-right text-2xs text-ink-muted"
                >
                  {Array.from(
                    { length: displaySettings.weekEndHour - displaySettings.weekStartHour + 1 },
                    (_, index) => displaySettings.weekStartHour + index,
                  ).map((hour) => (
                    <span
                      key={hour}
                      style={{
                        top: displaySettings.weekFitToView
                          ? `${((hour - displaySettings.weekStartHour) / (displaySettings.weekEndHour - displaySettings.weekStartHour)) * 100}%`
                          : (hour - displaySettings.weekStartHour) * HOUR_HEIGHT,
                      }}
                      className={cn(
                        'absolute right-2 tabular',
                        hour === displaySettings.weekEndHour
                          ? '-translate-y-full'
                          : '-translate-y-1/2',
                      )}
                    >
                      {hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`}
                    </span>
                  ))}
                </div>
              )}
            >
              {(run) =>
                run.days.map(({ day, zone }) => {
                const positioned = positionEvents(
                  calendarByDay.get(day) ?? [],
                  columnZone(zone),
                  windowStart,
                  windowEnd,
                  displaySettings.weekFitToView,
                );

                return (
                  <DayColumn
                    key={day}
                    day={day}
                    disabled={readOnly}
                    selected={false}
                    /*
                      One band, whether it is a time being dragged out or an
                      event being carried onto this day. They cannot happen at
                      once -- a press either lands on a card or on the sheet --
                      and both answer the same question about where a thing
                      would go.
                    */
                    band={landing(
                      selecting && selecting.day === day
                        ? { start: selecting.start, end: selecting.end }
                        : carry?.travelled && carry.day === day
                          ? { start: carry.minutes, end: carry.minutes + carry.length }
                          : null,
                    )}
                    onStart={(minutes) => {
                      setCreating(null);
                      setDrag({ day, from: minutes, to: minutes });
                    }}
                    onMove={(minutes) =>
                      setDrag((current) =>
                        current && current.day === day ? { ...current, to: minutes } : current,
                      )
                    }
                    onFinish={finishDrag}
                    onAdd={() => setCreating({ day, name: '' })}
                    windowStart={windowStart}
                    windowEnd={windowEnd}
                    fitToView={displaySettings.weekFitToView}
                  >
                    {positioned.map(
                      ({ event, top, height, column, columns, outsideBefore, outsideAfter }) => (
                        <button
                          key={event.id}
                          type="button"
                          data-testid="week-event"
                          data-event-id={event.id}
                          onClick={() => {
                            // The release that ended a drag also fires a click.
                            // Moving the event was the whole gesture; opening it
                            // as well would bury the move under an editor.
                            if (dropped.current) {
                              dropped.current = false;
                              return;
                            }
                            onOpenEvent(event.id);
                          }}
                          /*
                           * A mouse may carry an event to another time. A finger
                           * may not: dragging a card and scrolling the week are
                           * the same gesture, and taking it for a move would
                           * make a week of events unscrollable. Opening the
                           * event and editing its time still works there.
                           */
                          onPointerDown={(e) => {
                            if (readOnly || e.pointerType === 'touch') return;
                            if (event.startsAt === undefined) return;

                            const card = e.currentTarget.getBoundingClientRect();
                            setDrag(null);
                            setCarry({
                              id: event.id,
                              day,
                              minutes: minutesSinceMidnight(event.startsAt, columnZone(zone)),
                              length: Math.max(
                                SNAP_MINUTES,
                                event.durationMinutes ?? DEFAULT_EVENT_MINUTES,
                              ),
                              grab: e.clientY - card.top,
                              travelled: false,
                            });
                          }}
                          style={{
                            ...coloredSurfaceStyle(event.color),
                            top,
                            height,
                            left: `calc(${(column / columns) * 100}% + 2px)`,
                            width: `calc(${100 / columns}% - 4px)`,
                          }}
                          className={cn(
                            'week-event-card absolute flex gap-1.5 overflow-hidden rounded-sm border border-line bg-card px-1 py-1 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2',
                            // A cut edge, so a pinned event does not read as one that
                            // really starts or ends at the hour it is resting on.
                            outsideBefore && 'border-t-ink-muted [border-top-style:dashed]',
                            outsideAfter && 'border-b-ink-muted [border-bottom-style:dashed]',
                            !readOnly && 'cursor-grab',
                            // Left where it was, faded, while its shadow shows
                            // where it would land. Hiding it would make the week
                            // reflow around a gap that is about to be filled.
                            carry?.id === event.id && carry.travelled && 'opacity-40',
                          )}
                        >
                          <StatusSpine status={event.booking.status} />
                          <span className="week-event-content min-w-0 flex-1">
                            {event.startsAt !== undefined && (
                              <span className="week-event-time tabular flex items-center gap-0.5 text-2xs text-ink-muted">
                                {outsideBefore && (
                                  <ChevronUp aria-hidden="true" className="size-3" />
                                )}
                                {formatTime(
                                  event.startsAt,
                                  displayZone(event.timezone, homeTimezone),
                                )}
                                {/*
                                  Named only where it differs from the column
                                  it is drawn in. A flight out of Tokyo keeps
                                  its 09:00 in a column that is on another
                                  clock, and without the tag that reads as an
                                  event three hours from where it is drawn.
                                */}
                                {foreignZone(event, zone) && (
                                  <span className="text-ink-muted">
                                    {timeZoneAbbreviation(
                                      event.startsAt,
                                      displayZone(event.timezone, homeTimezone),
                                    )}
                                  </span>
                                )}
                                {outsideAfter && !outsideBefore && (
                                  <ChevronDown aria-hidden="true" className="size-3" />
                                )}
                                {(outsideBefore || outsideAfter) && (
                                  <span className="sr-only">
                                    {outsideBefore
                                      ? ', earlier than the hours shown'
                                      : ', later than the hours shown'}
                                  </span>
                                )}
                              </span>
                            )}
                            <span
                              data-testid="week-event-name"
                              className="week-event-name flex min-w-0 items-center gap-1"
                            >
                              <EventKindIcon
                                kind={event.kind}
                                className="size-3 shrink-0 text-ink-muted"
                              />
                              <span
                                className={cn(
                                  'truncate text-xs',
                                  event.name ? 'text-ink' : 'text-ink-placeholder italic',
                                )}
                              >
                                {event.name || 'Unnamed'}
                              </span>
                            </span>
                          </span>
                        </button>
                      ),
                    )}
                    {creating?.day === day &&
                      creating.start !== undefined &&
                      creating.end !== undefined && (
                        <InlineEventDraft
                          name={creating.name}
                          onChange={(name) =>
                            setCreating((current) => (current ? { ...current, name } : current))
                          }
                          onCommit={commitCreation}
                          onCancel={() => setCreating(null)}
                          className="absolute inset-x-0.5"
                          style={{
                            top: displaySettings.weekFitToView
                              ? `${((creating.start - windowStart) / (windowEnd - windowStart)) * 100}%`
                              : (creating.start - windowStart) * MINUTE_HEIGHT,
                            height: displaySettings.weekFitToView
                              ? `max(30px, calc(${((creating.end - creating.start) / (windowEnd - windowStart)) * 100}% - 2px))`
                              : Math.max(30, (creating.end - creating.start) * MINUTE_HEIGHT - 2),
                          }}
                        />
                      )}
                  </DayColumn>
                );
              })
              }
            </RunRows>
          </div>

          {/*
            Where you are sleeping, held at the bottom of the box. It is the
            point of this view, so it stays put while the hours above it scroll
            rather than being something to scroll down and find.
          */}
          <section
            /*
             * The padding underneath is what keeps the bars off the horizontal
             * scrollbar, which would otherwise be drawn across the hotel names
             * and the controls for booking a night.
             */
            className="sticky bottom-0 z-30 mt-2 shrink-0 bg-page pt-1 pb-4"
            aria-label="Where you are sleeping"
          >
            {beds.length === 0 && (readOnly || empties.length === 0) ? (
              <p className="px-1 py-2 text-2xs text-ink-muted">
                No hotels this week. Add an event and set its kind to lodging to see it here.
              </p>
            ) : (
              <RunRows runs={runs} testId="lodging-rail" rail={() => null}>
                {(run) => {
                  const runDays = run.days.map((slot) => slot.day);
                  const first = runDays[0]!;
                  const last = runDays[runDays.length - 1]!;

                  return (
                    <>
                      {/*
                        A stay is drawn once per run of days it covers. A hotel
                        held over a zone change is one booking and two bars,
                        because the runs either side of the change are laid out
                        separately -- the alternative is a bar drawn across a
                        rail belonging to another clock.
                      */}
                      {beds.map((span) => {
                        const placed = spanWithin(span, runDays);
                        if (!placed) return null;

                        return (
                          <WeekLodging
                            key={`${span.event.id}:${first}`}
                            event={span.event}
                            gridColumn={`${placed.start + 1} / span ${placed.length}`}
                            scroller={horizontalScroller}
                            onOpen={() => onOpenEvent(span.event.id)}
                          />
                        );
                      })}

                      {/*
                       * The nights nothing covers, offered one by one rather
                       * than left blank. An empty stretch of rail said only
                       * that a hotel would be drawn here if one existed, and
                       * left making it to another screen.
                       */}
                      {!readOnly &&
                        emptyNights
                          .filter(({ day }) => day >= first && day <= last)
                          .map(({ day }) => {
                            // The nights being named are one input across all
                            // of them, so the offers underneath it stand down.
                            if (bedDraft && day >= bedDraft.from && day <= bedDraft.to) {
                              return null;
                            }

                            return (
                              <AddLodging
                                key={day}
                                day={day}
                                column={runDays.indexOf(day) + 1}
                                selected={
                                  bedDrag !== null && day >= bedDrag.from && day <= bedDrag.to
                                }
                                onPress={(touch) => {
                                  // Remembered so the click that follows knows
                                  // whether the drag above dealt with it.
                                  bedPressWasMouse.current = !touch;
                                  if (!touch) setBedDrag({ anchor: day, from: day, to: day });
                                }}
                                onEnter={() => dragOver(day)}
                                onTap={() => {
                                  if (bedPressWasMouse.current) return;
                                  setBedDraft({ from: day, to: day, name: '' });
                                }}
                              />
                            );
                          })}

                      {bedDraft && !readOnly && bedDraft.from <= last && bedDraft.to >= first && (
                        <InlineEventDraft
                          name={bedDraft.name}
                          label="Hotel name"
                          onChange={(name) =>
                            setBedDraft((current) => (current ? { ...current, name } : current))
                          }
                          onCommit={commitLodging}
                          onCancel={() => setBedDraft(null)}
                          className="rounded-full"
                          style={{
                            gridColumn: `${runDays.indexOf(clampDay(bedDraft.from, first, last)) + 1} / ${
                              runDays.indexOf(clampDay(bedDraft.to, first, last)) + 2
                            }`,
                            gridRow: 1,
                          }}
                        />
                      )}
                    </>
                  );
                }}
              </RunRows>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
