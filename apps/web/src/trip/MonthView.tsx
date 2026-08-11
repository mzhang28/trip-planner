import type { TripEvent } from '@trip/crdt';
import { cn } from '@trip/ui';
import { useDroppable } from '@dnd-kit/core';
import type { DayKey } from '../lib/calendar';
import { citySegments, eventsByDay, monthGrid, monthOf } from '../lib/calendar';
import { weatherGlyph, type DailyWeather } from './useWeather';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface MonthViewProps {
  anchor: DayKey;
  events: TripEvent[];
  homeTimezone: string;
  weather: Map<DayKey, DailyWeather>;
  today: DayKey;
  readOnly: boolean;
  onOpenDay: (day: DayKey) => void;
  /** Makes an event on that day, with nothing filled in but the day. */
  onCreateOn: (day: DayKey) => void;
}

/**
 * One day in the month.
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
        'group relative flex min-h-16 flex-col items-stretch gap-0.5 sm:min-h-20 lg:min-h-24 xl:min-h-28',
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
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-1 bottom-1 text-2xs text-ink-placeholder opacity-0 group-hover:opacity-100"
          >
            +
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * A month read as places rather than as appointments.
 *
 * Consecutive days in one city join into a continuous band carrying the name,
 * so a month of a trip shows three or four places instead of thirty separate
 * squares. What someone wants from a month of a trip is where they are, and
 * only then what is on.
 */
export function MonthView({
  anchor,
  events,
  homeTimezone,
  weather,
  today,
  readOnly,
  onOpenDay,
  onCreateOn,
}: MonthViewProps) {
  const days = monthGrid(anchor);
  const byDay = eventsByDay(events, homeTimezone);
  const cities = citySegments(byDay, days);
  const thisMonth = monthOf(anchor);

  const weeks: DayKey[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-px pb-1">
        {WEEKDAYS.map((label) => (
          <div key={label} className="px-1 text-2xs font-medium text-ink-muted">
            {label}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        {weeks.map((week) => (
          <div key={week[0]}>
            {/* The place ribbon, drawn across the week above its days. */}
            <div className="grid grid-cols-7 gap-px bg-line">
              {week.map((day) => {
                const segment = cities.find((run) => day >= run.from && day <= run.to);
                const startsHere = segment && (segment.from === day || day === week[0]);

                return (
                  <div
                    key={day}
                    className={cn(
                      'truncate px-1.5 py-0.5 text-2xs font-medium',
                      segment ? 'bg-accent-soft text-accent-text' : 'bg-card',
                    )}
                  >
                    {/* Empty, not transparent: see the week view. */}
                    {startsHere ? segment.label : ''}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-7 gap-px bg-line">
              {week.map((day) => {
                const dayEvents = byDay.get(day) ?? [];
                const forecast = weather.get(day);
                const glyph = forecast ? weatherGlyph(forecast.code) : null;
                const outside = monthOf(day) !== thisMonth;

                return (
                  <DayCell
                    key={day}
                    day={day}
                    disabled={readOnly}
                    onOpen={() => onOpenDay(day)}
                    onCreate={() => onCreateOn(day)}
                    className={outside ? 'bg-sunken' : 'bg-card'}
                  >
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
                        <span className="text-2xs text-ink-muted" title={glyph.label}>
                          <span aria-hidden="true">{glyph.icon}</span>
                          <span className="tabular ml-0.5 hidden sm:inline">
                            {Math.round(forecast.max)}°
                          </span>
                        </span>
                      )}
                    </span>

                    {dayEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(day)}
                        className="relative z-10 mt-auto px-1 pb-1 text-left text-2xs text-ink-muted hover:text-ink focus-visible:outline-focus focus-visible:outline-2">
                        {/*
                          A count rather than a list. At this size the names
                          would be three characters each, which tells you less
                          than knowing there are four things to look at.
                        */}
                        {dayEvents.length} {dayEvents.length === 1 ? 'thing' : 'things'}
                      </button>
                    )}
                  </DayCell>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
