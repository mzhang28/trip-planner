import type { TripEvent } from '@trip/crdt';
import { StatusSpine, cn } from '@trip/ui';
import { useDroppable } from '@dnd-kit/core';
import type { DayKey } from '../lib/calendar';
import { citySegments, eventsByDay, lodgingSpans, spanWithin, weekOf } from '../lib/calendar';
import { formatTime } from '../lib/time';
import { useDisplayZone } from './useDisplayZone';
import { weatherGlyph, type DailyWeather } from './useWeather';

export interface WeekViewProps {
  anchor: DayKey;
  events: TripEvent[];
  homeTimezone: string;
  weather: Map<DayKey, DailyWeather>;
  today: DayKey;
  readOnly: boolean;
  onOpenEvent: (eventId: string) => void;
}

function DayColumn({
  day,
  children,
  disabled,
}: {
  day: DayKey;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, disabled });

  return (
    <div
      ref={setNodeRef}
      data-testid={`day-${day}`}
      className={cn('flex min-w-32 flex-col gap-1 p-1', isOver && 'bg-accent-soft')}
    >
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
}: WeekViewProps) {
  const days = weekOf(anchor);
  const byDay = eventsByDay(events, homeTimezone);
  const displayZone = useDisplayZone();
  const cities = citySegments(byDay, days);
  const beds = lodgingSpans(events, homeTimezone).filter((span) => spanWithin(span, days));

  return (
    /*
     * The wrapper is focusable because it scrolls sideways. A region that can
     * be scrolled but not focused cannot be reached by anyone driving the page
     * from the keyboard.
     */
    <div
      className="overflow-x-auto"
      tabIndex={0}
      role="group"
      aria-label="This week, scroll sideways for the other days"
    >
      <div className="min-w-3xl">
        {/* City bands: the same device the month view uses, one row high. */}
        {cities.length > 0 && (
          <div className="grid grid-cols-7 gap-px pb-1">
            {days.map((day) => {
              const segment = cities.find((run) => day >= run.from && day <= run.to);
              const isStart = segment?.from === day;

              return (
                <div
                  key={day}
                  className={cn(
                    'truncate px-2 py-0.5 text-2xs font-medium',
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

        <div className="grid grid-cols-7 gap-px rounded-lg border border-line bg-line">
          {days.map((day) => {
            const forecast = weather.get(day);
            const glyph = forecast ? weatherGlyph(forecast.code) : null;

            return (
              <div key={day} className="bg-card px-2 py-1.5 text-center">
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
                  <div className="text-2xs text-ink-muted" title={glyph.label}>
                    <span aria-hidden="true">{glyph.icon}</span>{' '}
                    <span className="tabular">
                      {Math.round(forecast.max)}°/{Math.round(forecast.min)}°
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {days.map((day) => (
            <div key={day} className="min-h-40 bg-card lg:min-h-[calc(100dvh-22rem)]">
              <DayColumn day={day} disabled={readOnly}>
                {(byDay.get(day) ?? []).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    data-testid="week-event"
                    onClick={() => onOpenEvent(event.id)}
                    className="flex w-full gap-1.5 rounded-sm border border-line bg-card px-1 py-1 text-left hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2"
                  >
                    <StatusSpine status={event.booking.status} />
                    <span className="min-w-0 flex-1">
                      {event.startsAt !== undefined && (
                        <span className="tabular block text-2xs text-ink-muted">
                          {formatTime(event.startsAt, displayZone(event.timezone, homeTimezone))}
                        </span>
                      )}
                      <span className="block truncate text-xs text-ink">{event.name}</span>
                    </span>
                  </button>
                ))}
              </DayColumn>
            </div>
          ))}
        </div>

        <section className="mt-2" aria-label="Where you are sleeping">
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
    </div>
  );
}
