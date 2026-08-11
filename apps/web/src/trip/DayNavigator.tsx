import { Button, cn } from '@trip/ui';
import type { DayKey } from '../lib/calendar';
import { addDays, startOfWeek } from '../lib/calendar';

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
    const start = startOfWeek(anchor);
    return `Week of ${new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(Date.parse(`${start}T12:00:00Z`))}`;
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

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button size="sm" onPress={() => onChange(addDays(anchor, -step))}>
        Earlier
      </Button>
      <Button size="sm" onPress={() => onChange(today)}>
        Today
      </Button>
      <Button size="sm" onPress={() => onChange(addDays(anchor, step))}>
        Later
      </Button>

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

      <span data-testid="range-label" className="text-xs text-ink-muted">
        {describe(view, anchor)}
      </span>
    </div>
  );
}
