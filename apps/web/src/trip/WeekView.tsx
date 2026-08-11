import type { TripEvent } from '@trip/crdt';
import { StatusSpine, cn } from '@trip/ui';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DayKey } from '../lib/calendar';
import { addDays, citySegments, eventsByDay, lodgingSpans, spanWithin } from '../lib/calendar';
import { formatTime } from '../lib/time';
import { useCalendarDisplaySettings } from './useCalendarDisplaySettings';
import { useDisplayZone } from './useDisplayZone';
import { weatherGlyph, type DailyWeather } from './useWeather';

/* A calendar hour needs enough room for a readable short event. */
const HOUR_HEIGHT = 56;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
const DEFAULT_EVENT_MINUTES = 30;
const BUFFER_DAYS_BEFORE = 1;
const RENDERED_DAY_COUNT = 15;

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

function minutesSinceMidnight(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(at);
  const value = (part: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === part)?.value ?? '0');

  return (value('hour') % 24) * 60 + value('minute');
}

/**
 * Places events in their true time slot and gives overlapping appointments a
 * lane of their own. Without lanes, two 09:00 appointments obscure each
 * other; without absolute positions, a 17:00 appointment reads as though it
 * follows breakfast.
 */
function positionEvents(
  events: TripEvent[],
  displayZone: (eventZone: string | undefined, homeZone: string) => string,
  homeTimezone: string,
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
      const actualStart = minutesSinceMidnight(
        event.startsAt,
        displayZone(event.timezone, homeTimezone),
      );
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

export interface WeekViewProps {
  anchor: DayKey;
  events: TripEvent[];
  homeTimezone: string;
  weather: Map<DayKey, DailyWeather>;
  today: DayKey;
  readOnly: boolean;
  onOpenEvent: (eventId: string) => void;
  onChangeAnchor: (day: DayKey) => void;
  /**
   * Makes an event on that day, over that time when a drag said one.
   *
   * A tap says which day and nothing else, which is a state the event can hold
   * now rather than a reason to invent an hour for it.
   */
  onCreateAt: (day: DayKey, name: string, startMinutes?: number, endMinutes?: number) => void;
}

function InlineEventDraft({
  name,
  onChange,
  onCommit,
  onCancel,
  className,
  style,
}: {
  name: string;
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
        <span className="sr-only">Event name</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) onCommit();
            if (event.key === 'Escape') onCancel();
          }}
          onBlur={() => (name.trim() ? onCommit() : onCancel())}
          placeholder="Event name"
          className="h-6 w-full min-w-0 rounded-sm border-0 bg-card/80 px-1 text-xs text-ink outline-none placeholder:text-ink-placeholder focus:ring-2 focus:ring-accent"
        />
      </label>
    </div>
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
        'relative block min-w-0 bg-card',
        isOver && 'bg-accent-soft',
        selected && 'bg-accent-soft',
        !disabled && 'cursor-cell',
      )}
      style={{
        height: fitToView ? '100%' : (windowEnd - windowStart) * MINUTE_HEIGHT,
        backgroundImage:
          'linear-gradient(to bottom, transparent calc(100% - 1px), var(--border-subtle) 1px)',
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
  events,
  homeTimezone,
  weather,
  today,
  readOnly,
  onOpenEvent,
  onChangeAnchor,
  onCreateAt,
}: WeekViewProps) {
  const days = useMemo(
    () =>
      Array.from({ length: RENDERED_DAY_COUNT }, (_, index) =>
        addDays(anchor, index - BUFFER_DAYS_BEFORE),
      ),
    [anchor],
  );
  const displaySettings = useCalendarDisplaySettings();
  const windowStart = displaySettings.weekStartHour * 60;
  const windowEnd = displaySettings.weekEndHour * 60;
  const timetableHeight = (windowEnd - windowStart) * MINUTE_HEIGHT;
  const horizontalScroller = useRef<HTMLDivElement>(null);
  const anchorCell = useRef<HTMLDivElement>(null);
  const centeredScrollLeft = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridTemplateColumns = `2.5rem repeat(${days.length}, minmax(5.5rem, calc((100cqw - 2.5rem - 7px) / 7)))`;

  /*
   * Keep one week visible, but render a week of runway on either side. Once a
   * horizontal gesture settles, that newly visible first day becomes the
   * anchor and the runway is rebuilt around it. The pixels stay in the same
   * place while the user gets an effectively unbounded strip of dates.
   */
  useLayoutEffect(() => {
    const scroller = horizontalScroller.current;
    const cell = anchorCell.current;
    if (!scroller || !cell) return;

    const gutterWidth = 40;
    const nextScrollLeft =
      scroller.scrollLeft +
      cell.getBoundingClientRect().left -
      scroller.getBoundingClientRect().left -
      gutterWidth -
      1;
    centeredScrollLeft.current = nextScrollLeft;
    scroller.scrollLeft = nextScrollLeft;
  }, [anchor]);

  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  function settleHorizontalScroll() {
    const scroller = horizontalScroller.current;
    const cell = anchorCell.current;
    if (!scroller || !cell) return;

    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const dayStep = cell.getBoundingClientRect().width + 1;
      const dayOffset = Math.round((scroller.scrollLeft - centeredScrollLeft.current) / dayStep);
      if (dayOffset !== 0) onChangeAnchor(addDays(anchor, dayOffset));
    }, 140);
  }

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

  const selecting = drag
    ? {
        day: drag.day,
        start: Math.min(drag.from, drag.to),
        // A press with no travel still means something: half an hour from
        // there, which is the commonest thing to want and easy to change.
        end: Math.max(drag.from, drag.to, Math.min(drag.from, drag.to) + DEFAULT_EVENT_MINUTES),
      }
    : null;

  function finishDrag() {
    if (selecting) setCreating({ ...selecting, name: '' });
    setDrag(null);
  }

  function commitCreation() {
    if (!creating) return;

    const name = creating.name.trim();
    if (!name) return;

    onCreateAt(creating.day, name, creating.start, creating.end);
    setCreating(null);
  }
  const byDay = eventsByDay(events, homeTimezone);
  const displayZone = useDisplayZone();
  const cities = citySegments(byDay, days);
  const beds = lodgingSpans(events, homeTimezone).filter((span) => spanWithin(span, days));

  // Split off the ones on a day but not at an hour. They belong to the day and
  // to no point in it, so they get a row of their own above the grid.
  const untimed = new Map<DayKey, TripEvent[]>();
  for (const day of days) {
    const waiting = (byDay.get(day) ?? []).filter((event) => event.timeUndecided);
    if (waiting.length > 0) untimed.set(day, waiting);
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      role="group"
      aria-label="Week view"
      // A drag that ends outside the grid is abandoned rather than left armed.
      onPointerLeave={() => setDrag(null)}
    >
      <div
        ref={horizontalScroller}
        data-testid="week-horizontal-scroll"
        onScroll={settleHorizontalScroll}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ containerType: 'inline-size' }}
      >
        <div className="flex h-full w-max min-w-full flex-col">
          {/* City and date rows do not move when the timetable scrolls vertically. */}
          <div className="shrink-0">
            {cities.length > 0 && (
              <div className="grid gap-px pb-1" style={{ gridTemplateColumns }}>
                <div className="sticky left-0 z-20 bg-page" />
                {days.map((day) => {
                  const segment = cities.find((run) => day >= run.from && day <= run.to);
                  const isStart = segment?.from === day;

                  return (
                    <div
                      key={day}
                      className={cn(
                        'truncate px-1 py-0.5 text-2xs font-medium',
                        segment ? 'bg-accent-soft text-accent-text' : 'text-transparent',
                        segment && day === segment.from && 'rounded-l-full',
                        segment && day === segment.to && 'rounded-r-full',
                      )}
                    >
                      {isStart ? segment.label : ' '}
                    </div>
                  );
                })}
              </div>
            )}

            <div
              className="grid gap-px rounded-t-lg border border-line bg-line"
              style={{ gridTemplateColumns }}
            >
              <div className="sticky left-0 z-20 bg-page" />
              {days.map((day) => {
                const forecast = weather.get(day);
                const glyph = forecast ? weatherGlyph(forecast.code) : null;

                return (
                  <div
                    key={day}
                    ref={day === anchor ? anchorCell : undefined}
                    data-week-day={day}
                    className="min-w-0 bg-card px-1 py-1.5 text-center"
                  >
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
                      <div className="truncate text-2xs text-ink-muted" title={glyph.label}>
                        <span aria-hidden="true">{glyph.icon}</span>{' '}
                        <span className="tabular hidden sm:inline">
                          {Math.round(forecast.max)}°/{Math.round(forecast.min)}°
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/*
              Events on a day with no hour yet, above the hours rather than in
              them. Drawing one at midnight would put a "Thursday, some time"
              plan at the top of the grid as though that were the plan.
            */}
            {(untimed.size > 0 || (creating && creating.start === undefined)) && (
              <div className="grid gap-px border-x border-line bg-line" style={{ gridTemplateColumns }}>
                <div className="sticky left-0 z-20 bg-page py-0.5 pr-1 text-right text-2xs text-ink-muted">
                  Any
                </div>
                {days.map((day) => (
                  <div key={day} className="flex min-w-0 flex-col gap-0.5 bg-card p-0.5">
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
                        className="flex gap-1 overflow-hidden rounded-sm border border-dashed border-line bg-card px-1 py-0.5 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2"
                      >
                        <StatusSpine status={event.booking.status} />
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
                ))}
              </div>
            )}
          </div>

          {/* Time scroll is independent; every rendered day stays aligned. */}
          <div
            data-testid="week-timetable-scroll"
            tabIndex={0}
            className={cn(
              'min-h-0 flex-1 overscroll-y-contain rounded-b-lg border-x border-b border-line',
              displaySettings.weekFitToView ? 'overflow-hidden' : 'overflow-y-auto',
            )}
          >
            <div
              className="grid gap-px bg-line"
              style={{
                gridTemplateColumns,
                height: displaySettings.weekFitToView ? '100%' : timetableHeight,
              }}
            >
              <div
                aria-hidden="true"
                className="sticky left-0 z-20 bg-page text-right text-2xs text-ink-muted"
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
                      'absolute right-1 tabular',
                      hour === displaySettings.weekEndHour
                        ? '-translate-y-full'
                        : '-translate-y-1/2',
                    )}
                  >
                    {hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`}
                  </span>
                ))}
              </div>

              {days.map((day) => {
                const positioned = positionEvents(
                  byDay.get(day) ?? [],
                  displayZone,
                  homeTimezone,
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
                    band={
                      selecting && selecting.day === day
                        ? {
                            top: displaySettings.weekFitToView
                              ? `${((selecting.start - windowStart) / (windowEnd - windowStart)) * 100}%`
                              : (selecting.start - windowStart) * MINUTE_HEIGHT,
                            height: displaySettings.weekFitToView
                              ? `${((selecting.end - selecting.start) / (windowEnd - windowStart)) * 100}%`
                              : (selecting.end - selecting.start) * MINUTE_HEIGHT,
                          }
                        : null
                    }
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
                          onClick={() => onOpenEvent(event.id)}
                          style={{
                            top,
                            height,
                            left: `calc(${(column / columns) * 100}% + 2px)`,
                            width: `calc(${100 / columns}% - 4px)`,
                          }}
                          className={cn(
                            'absolute flex gap-1.5 overflow-hidden rounded-sm border border-line bg-card px-1 py-1 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2',
                            // A cut edge, so a pinned event does not read as one that
                            // really starts or ends at the hour it is resting on.
                            outsideBefore && 'border-t-ink-muted [border-top-style:dashed]',
                            outsideAfter && 'border-b-ink-muted [border-bottom-style:dashed]',
                          )}
                        >
                          <StatusSpine status={event.booking.status} />
                          <span className="min-w-0 flex-1">
                            {event.startsAt !== undefined && (
                              <span className="tabular flex items-center gap-0.5 text-2xs text-ink-muted">
                                {outsideBefore && (
                                  <ChevronUp aria-hidden="true" className="size-3" />
                                )}
                                {formatTime(
                                  event.startsAt,
                                  displayZone(event.timezone, homeTimezone),
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
                              className={cn(
                                'block truncate text-xs',
                                event.name ? 'text-ink' : 'text-ink-placeholder italic',
                              )}
                            >
                              {event.name || 'Unnamed'}
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
              })}
            </div>
          </div>

          <section className="mt-2 shrink-0" aria-label="Where you are sleeping">
            {beds.length === 0 ? (
              <p className="px-1 py-2 text-2xs text-ink-muted">
                No hotels this week. Add an event and set its kind to lodging to see it here.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {beds.map((span) => {
                  const placed = spanWithin(span, days)!;

                  return (
                    <div
                      key={span.event.id}
                      className="grid gap-px"
                      style={{ gridTemplateColumns }}
                    >
                      <div className="sticky left-0 z-20 bg-page" />
                      <button
                        type="button"
                        onClick={() => onOpenEvent(span.event.id)}
                        style={{ gridColumn: `${placed.start + 2} / span ${placed.length}` }}
                        className={cn(
                          'flex items-center gap-1.5 truncate rounded-full border border-line-default bg-sunken px-2 py-1',
                          'text-left text-2xs text-ink hover:bg-card focus-visible:outline-focus focus-visible:outline-2',
                        )}
                      >
                        <StatusSpine
                          status={span.event.booking.status}
                          orientation="horizontal"
                          className="w-4 shrink-0"
                        />
                        <span className="truncate">{span.event.name}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
