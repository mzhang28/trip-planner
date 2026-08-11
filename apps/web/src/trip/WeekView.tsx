import type { TripEvent } from '@trip/crdt';
import { StatusSpine, cn } from '@trip/ui';
import { useDroppable } from '@dnd-kit/core';
import { useState } from 'react';
import type { DayKey } from '../lib/calendar';
import { citySegments, eventsByDay, lodgingSpans, spanWithin, weekOf } from '../lib/calendar';
import { formatTime } from '../lib/time';
import { useCalendarDisplaySettings } from './useCalendarDisplaySettings';
import { useDisplayZone } from './useDisplayZone';
import { weatherGlyph, type DailyWeather } from './useWeather';

/* A calendar hour needs enough room for a readable short event. */
const HOUR_HEIGHT = 56;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
const DEFAULT_EVENT_MINUTES = 30;

interface PositionedEvent {
  event: TripEvent;
  top: number;
  height: number;
  column: number;
  columns: number;
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
): PositionedEvent[] {
  const timed = events
    .filter((event): event is TripEvent & { startsAt: number } => event.startsAt !== undefined)
    .map((event) => {
      const actualStart = minutesSinceMidnight(
        event.startsAt,
        displayZone(event.timezone, homeTimezone),
      );
      const duration = Math.max(1, event.durationMinutes ?? DEFAULT_EVENT_MINUTES);

      return {
        event,
        start: Math.max(windowStart, actualStart),
        end: Math.min(windowEnd, actualStart + duration),
        column: 0,
        columns: 1,
      };
    })
    .filter((item) => item.end > item.start)
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

  return positioned.map((item) => ({
    event: item.event,
    top: (item.start - windowStart) * MINUTE_HEIGHT,
    // Leave a small visible gap between back-to-back appointments. The minimum
    // keeps an undetailed event tappable.
    height: Math.max(30, (item.end - item.start) * MINUTE_HEIGHT - 2),
    column: item.column,
    columns: item.columns,
  }));
}

export interface WeekViewProps {
  anchor: DayKey;
  events: TripEvent[];
  homeTimezone: string;
  weather: Map<DayKey, DailyWeather>;
  today: DayKey;
  readOnly: boolean;
  onOpenEvent: (eventId: string) => void;
  /** Makes an event over the days that were dragged across. */
  /** Makes an event at the time that was dragged out. */
  onCreateAt: (day: DayKey, startMinutes: number, endMinutes: number) => void;
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
  band,
  windowStart,
  windowEnd,
}: {
  day: DayKey;
  children: React.ReactNode;
  disabled: boolean;
  selected: boolean;
  onStart: (minutes: number) => void;
  onMove: (minutes: number) => void;
  onFinish: () => void;
  band: { top: number; height: number } | null;
  windowStart: number;
  windowEnd: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, disabled });

  /*
   * Where in the day the pointer is, to the nearest quarter hour. Snapping is
   * what makes a dragged-out time land on 09:15 rather than 09:13, which is
   * the difference between a time somebody would type and one they would have
   * to correct.
   */
  function minutesAt(e: React.PointerEvent<HTMLDivElement>): number {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minutes = windowStart + Math.round(y / MINUTE_HEIGHT / 15) * 15;

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
        height: (windowEnd - windowStart) * MINUTE_HEIGHT,
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 55px, var(--border-subtle) 56px)',
      }}
    >
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
  onCreateAt,
}: WeekViewProps) {
  const days = weekOf(anchor);
  const displaySettings = useCalendarDisplaySettings();
  const windowStart = displaySettings.weekStartHour * 60;
  const windowEnd = displaySettings.weekEndHour * 60;
  const timetableHeight = (windowEnd - windowStart) * MINUTE_HEIGHT;

  /*
   * Which days are being dragged across.
   *
   * A press picks the first day and moving picks the last, so a drag says both
   * when something starts and how long it goes on -- which is the whole reason
   * to drag rather than click. Held here rather than in the document: an
   * in-progress gesture is nobody else's business until it is finished.
   */
  const [drag, setDrag] = useState<{ day: DayKey; from: number; to: number } | null>(null);

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
    if (selecting) onCreateAt(selecting.day, selecting.start, selecting.end);
    setDrag(null);
  }
  const byDay = eventsByDay(events, homeTimezone);
  const displayZone = useDisplayZone();
  const cities = citySegments(byDay, days);
  const beds = lodgingSpans(events, homeTimezone).filter((span) => spanWithin(span, days));

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      role="group"
      aria-label="This week"
      // A drag that ends outside the grid is abandoned rather than left armed.
      onPointerLeave={() => setDrag(null)}
    >
      {/* City and date rows do not move when the timetable scrolls. */}
      <div className="shrink-0">
        {cities.length > 0 && (
          <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] gap-px pb-1">
            <div />
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

        <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] gap-px rounded-t-lg border border-line bg-line">
          <div className="bg-page" />
          {days.map((day) => {
            const forecast = weather.get(day);
            const glyph = forecast ? weatherGlyph(forecast.code) : null;

            return (
              <div key={day} className="min-w-0 bg-card px-1 py-1.5 text-center">
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
      </div>

      {/* This is the week's only scroll region. All seven days stay aligned. */}
      <div
        data-testid="week-timetable-scroll"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-lg border-x border-b border-line"
      >
        <div
          className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] gap-px bg-line"
          style={{ height: timetableHeight }}
        >
          <div aria-hidden="true" className="relative bg-page text-right text-2xs text-ink-muted">
            {Array.from(
              { length: displaySettings.weekEndHour - displaySettings.weekStartHour + 1 },
              (_, index) => displaySettings.weekStartHour + index,
            ).map((hour) => (
              <span
                key={hour}
                style={{ top: (hour - displaySettings.weekStartHour) * HOUR_HEIGHT }}
                className="absolute right-1 -translate-y-1/2 tabular"
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
                        top: (selecting.start - windowStart) * MINUTE_HEIGHT,
                        height: (selecting.end - selecting.start) * MINUTE_HEIGHT,
                      }
                    : null
                }
                onStart={(minutes) => setDrag({ day, from: minutes, to: minutes })}
                onMove={(minutes) =>
                  setDrag((current) =>
                    current && current.day === day ? { ...current, to: minutes } : current,
                  )
                }
                onFinish={finishDrag}
                windowStart={windowStart}
                windowEnd={windowEnd}
              >
                {positioned.map(({ event, top, height, column, columns }) => (
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
                    className="absolute flex gap-1.5 overflow-hidden rounded-sm border border-line bg-card px-1 py-1 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2"
                  >
                    <StatusSpine status={event.booking.status} />
                    <span className="min-w-0 flex-1">
                      {event.startsAt !== undefined && (
                        <span className="tabular block text-2xs text-ink-muted">
                          {formatTime(event.startsAt, displayZone(event.timezone, homeTimezone))}
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
                ))}
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
                  <div key={span.event.id} className="grid grid-cols-7 gap-px">
                    <button
                      type="button"
                      onClick={() => onOpenEvent(span.event.id)}
                      style={{ gridColumn: `${placed.start + 1} / span ${placed.length}` }}
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
  );
}
