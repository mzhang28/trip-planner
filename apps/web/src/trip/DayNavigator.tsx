import { Button, IconButton, cn } from '@trip/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DayKey } from '../lib/calendar';
import { addDays } from '../lib/calendar';
import {
  setCalendarDisplaySettings,
  useCalendarDisplaySettings,
} from './useCalendarDisplaySettings';

export type CalendarView = 'day' | 'week' | 'month';

export interface DayNavigatorProps {
  view: CalendarView;
  anchor: DayKey;
  today: DayKey;
  onChange: (day: DayKey) => void;
}

function describe(view: CalendarView, anchor: DayKey): string {
  const at = Date.parse(`${anchor}T12:00:00Z`);

  if (view === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(at);
  }

  if (view === 'week') {
    const format = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const end = addDays(anchor, 6);
    return `${format.format(at)} – ${format.format(Date.parse(`${end}T12:00:00Z`))}`;
  }

  // The year is in there because a trip is often planned months out, and
  // "Thursday 3 September" does not say which September.
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

/**
 * Moving about the trip, the same way in every view.
 *
 * The day used to have no way to reach another date at all, so an event could
 * only be put on one by dragging it there from wherever it landed. A date field
 * sits beside the steps because "the Tuesday after next" is faster to pick than
 * to reach a fortnight at a time.
 */
export function DayNavigator({ view, anchor, today, onChange }: DayNavigatorProps) {
  const step = view === 'month' ? 28 : view === 'week' ? 7 : 1;
  const display = useCalendarDisplaySettings();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Date navigation" className="inline-flex">
        <IconButton
          label="Earlier"
          size="sm"
          variant="secondary"
          onPress={() => onChange(addDays(anchor, -step))}
          className="rounded-r-none border-r-0 shadow-none before:inset-0"
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <Button size="sm" onPress={() => onChange(today)} className="rounded-none shadow-none">
          Today
        </Button>
        <IconButton
          label="Later"
          size="sm"
          variant="secondary"
          onPress={() => onChange(addDays(anchor, step))}
          className="rounded-l-none border-l-0 shadow-none before:inset-0"
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>

      <label className="flex items-center gap-2">
        <span className="sr-only">Go to a date</span>
        <input
          type="date"
          data-testid="go-to-date"
          value={anchor}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className={cn(
            'h-7 rounded-md border border-line-input bg-card px-2 text-xs text-ink',
            'focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
          )}
        />
      </label>

      {view === 'week' && (
        <details className="relative">
          <summary className="h-7 cursor-pointer rounded-md border border-line-input bg-card px-2 text-xs leading-7 text-ink hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2">
            Display
          </summary>
          <div className="absolute top-full left-0 z-20 mt-1 flex w-56 flex-col gap-3 rounded-lg border border-line bg-raised p-3 shadow-lg">
            <p className="text-xs text-ink-secondary">Week timetable hours</p>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={display.weekFitToView}
                onChange={(e) =>
                  setCalendarDisplaySettings({
                    ...display,
                    weekFitToView: e.target.checked,
                  })
                }
                className="size-4 accent-[var(--accent)]"
              />
              Fit hours to view
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-ink">
              Starts
              <select
                value={display.weekStartHour}
                onChange={(e) =>
                  setCalendarDisplaySettings({
                    ...display,
                    weekStartHour: Number(e.target.value),
                  })
                }
                className="h-7 rounded-md border border-line-input bg-card px-1 text-xs"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour} disabled={hour >= display.weekEndHour}>
                    {String(hour).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-ink">
              Ends
              <select
                value={display.weekEndHour}
                onChange={(e) =>
                  setCalendarDisplaySettings({
                    ...display,
                    weekEndHour: Number(e.target.value),
                  })
                }
                className="h-7 rounded-md border border-line-input bg-card px-1 text-xs"
              >
                {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                  <option key={hour} value={hour} disabled={hour <= display.weekStartHour}>
                    {hour === 24 ? '00:00 (next day)' : `${String(hour).padStart(2, '0')}:00`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      )}

      <span data-testid="range-label" className="text-xs text-ink-muted">
        {describe(view, anchor)}
      </span>
    </div>
  );
}
