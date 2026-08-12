import type { TripEvent } from '@trip/crdt';
import { StatusSpine, cn, coloredSurfaceStyle } from '@trip/ui';
import { useDroppable } from '@dnd-kit/core';
import type { DayKey } from '../lib/calendar';
import { addDays, cityDaySegments, eventsByDay, fourWeekGrid } from '../lib/calendar';
import { EventKindIcon } from './EventKind';
import { weatherGlyph, type DailyWeather } from './useWeather';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface MonthViewProps {
  anchor: DayKey;
  tripStart: DayKey;
  tripEnd: DayKey;
  events: TripEvent[];
  cityColors?: Record<string, string>;
  homeTimezone: string;
  weather: Map<DayKey, DailyWeather>;
  today: DayKey;
  readOnly: boolean;
  onOpenDay: (day: DayKey) => void;
  /** Makes an event on that day, with nothing filled in but the day. */
  onCreateOn: (day: DayKey) => void;
}

/**
 * One day in the four-week view.
 *
 * The date opens the day and the space below it makes an event on that day.
 * Two jobs, two targets: a single click that both opened the day and created
 * something would surprise whichever half was not wanted, and the space is
 * where a person points when they mean "put something here".
 */
function DayCell({
  day,
  disabled,
  children,
  onOpen,
  onCreate,
  className,
}: {
  day: DayKey;
  disabled: boolean;
  children: React.ReactNode;
  onOpen: () => void;
  onCreate: () => void;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, disabled });

  return (
    <div
      ref={setNodeRef}
      data-testid={`day-${day}`}
      className={cn(
        'group relative flex min-h-0 flex-col items-stretch gap-0.5 overflow-hidden',
        isOver && 'bg-accent-soft',
        className,
      )}
    >
      {children}

      {!disabled && (
        <button
          type="button"
          data-testid={`add-on-${day}`}
          aria-label={`Add an event on ${day}`}
          onClick={onCreate}
          className={cn(
            'absolute inset-x-0 bottom-0 top-6 cursor-pointer',
            'hover:bg-accent-soft/60 focus-visible:outline-focus focus-visible:outline-2 focus-visible:-outline-offset-2',
          )}
        >
          {/*
            Shown outright where there is no hover to reveal it. A touch user
            was creating events by tapping a cell that looked inert.
          */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-1 bottom-1 text-2xs text-ink-placeholder group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
          >
            +
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Four weeks read as places rather than as appointments.
 *
 * Each day's background is a 24-hour strip. A city change at noon therefore
 * puts the first city's colour in the top half and the next city's colour in
 * the bottom half. The fixed four rows use the available height without
 * making the route scroll.
 */
export function MonthView({
  anchor,
  tripStart,
  tripEnd,
  events,
  cityColors,
  homeTimezone,
  weather,
  today,
  readOnly,
  onOpenDay,
  onCreateOn,
}: MonthViewProps) {
  const days = fourWeekGrid(anchor);
  const byDay = eventsByDay(events, homeTimezone);
  const citiesByDay = cityDaySegments(events, days, homeTimezone);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 gap-px pb-1">
        {WEEKDAYS.map((label) => (
          <div key={label} className="px-1 text-2xs font-medium text-ink-muted">
            {label}
          </div>
        ))}
      </div>

      <div
        data-testid="month-grid"
        className="grid min-h-0 flex-1 grid-cols-7 grid-rows-4 gap-px overflow-hidden rounded-lg border border-line bg-line"
      >
        {days.map((day, dayIndex) => {
          const dayEvents = byDay.get(day) ?? [];
          const forecast = weather.get(day);
          const glyph = forecast ? weatherGlyph(forecast.code) : null;
          const outside = day < tripStart || day > tripEnd;
          const cityBands = citiesByDay.get(day) ?? [];
          const previousBands = citiesByDay.get(addDays(day, -1)) ?? [];
          const previousCity = previousBands.at(-1)?.label;

          return (
            <DayCell
              key={day}
              day={day}
              disabled={readOnly}
              onOpen={() => onOpenDay(day)}
              onCreate={() => onCreateOn(day)}
              className={outside ? 'bg-sunken' : 'bg-card'}
            >
              {cityBands.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex flex-col">
                  {cityBands.map((band) => {
                    const duration = band.toMinute - band.fromMinute;
                    const namesThisBand =
                      band.fromMinute > 0 || dayIndex % 7 === 0 || previousCity !== band.label;

                    return (
                      <div
                        key={`${band.label}:${band.fromMinute}`}
                        data-testid="city-time-band"
                        data-city={band.label}
                        data-from-minute={band.fromMinute}
                        data-to-minute={band.toMinute}
                        style={{
                          flexBasis: 0,
                          flexGrow: duration,
                          ...coloredSurfaceStyle(cityColors?.[band.label]),
                        }}
                        className={cn(
                          'min-h-0 overflow-hidden px-1.5 py-0.5 text-2xs font-medium',
                          namesThisBand && band.fromMinute === 0 && 'pl-6',
                          cityColors?.[band.label]
                            ? undefined
                            : 'bg-accent-soft text-accent-text',
                        )}
                      >
                        {namesThisBand ? band.label : ''}
                      </div>
                    );
                  })}
                </div>
              )}

                    <span className="relative z-10 flex items-baseline justify-between gap-1 p-1">
                      <button
                        type="button"
                        onClick={() => onOpenDay(day)}
                        aria-label={`Open ${day}`}
                        className={cn(
                          'tabular rounded-sm px-1 text-xs hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2',
                          day === today
                            ? 'font-semibold text-now-text'
                            : outside
                              ? // Muted rather than placeholder: a date either
                                // side of the month is still a date someone
                                // reads, and placeholder does not clear 4.5:1
                                // against the sunken surface it sits on.
                                'text-ink-muted'
                              : 'text-ink',
                        )}
                      >
                        {Number(day.slice(8))}
                      </button>
                      {glyph && forecast && (
                        <span
                          className="text-2xs text-ink-muted"
                          title={
                            forecast.place ? `${glyph.label} in ${forecast.place}` : glyph.label
                          }
                        >
                          <span aria-hidden="true">{glyph.icon}</span>
                          <span className="tabular ml-0.5 hidden sm:inline">
                            {Math.round(forecast.max)}°
                          </span>
                          {forecast.place && <span className="sr-only"> in {forecast.place}</span>}
                        </span>
                      )}
                    </span>

                    {dayEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(day)}
                        className="relative z-10 mt-auto flex w-full flex-col items-stretch gap-px px-1 pb-1 text-left focus-visible:outline-focus focus-visible:outline-2"
                      >
                        {/*
                          Two names and a count, not a count alone. "2 things"
                          made every day of a month look the same, so the month
                          could not answer the question it exists for -- what is
                          happening, roughly, and when.
                        */}
                        {dayEvents.slice(0, 2).map((event) => (
                          <span
                            key={event.id}
                            style={coloredSurfaceStyle(event.color)}
                            className={cn(
                              'flex min-w-0 items-center gap-1 text-2xs text-ink',
                              event.color && 'rounded-sm px-1 py-0.5',
                            )}
                          >
                            <StatusSpine status={event.booking.status} className="h-2.5 w-0.5" />
                            <EventKindIcon
                              kind={event.kind}
                              className="size-3 shrink-0 text-ink-muted"
                            />
                            <span
                              className={cn(
                                'truncate',
                                event.name ? 'text-ink' : 'text-ink-placeholder italic',
                              )}
                            >
                              {event.name || 'Unnamed'}
                            </span>
                          </span>
                        ))}

                        {dayEvents.length > 2 && (
                          <span className="text-2xs text-ink-muted">
                            +{dayEvents.length - 2} more
                          </span>
                        )}
                      </button>
                    )}
            </DayCell>
          );
        })}
      </div>
    </div>
  );
}
