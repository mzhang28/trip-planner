import { IconButton, cn } from '@trip/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DayKey } from '../lib/calendar';
import { addDays, clampDay } from '../lib/calendar';
import { formatHourLabel } from '../lib/time';
import {
  setCalendarDisplaySettings,
  useCalendarDisplaySettings,
} from './useCalendarDisplaySettings';

export type CalendarView = 'day' | 'week' | 'month';

export interface DayNavigatorProps {
  view: CalendarView;
  anchor: DayKey;
  /** Inclusive bounds used by the finite week strip. */
  tripStart?: DayKey;
  tripEnd?: DayKey;
  onChange: (day: DayKey) => void;
}

/**
 * Moving about the trip, the same way in every view.
 *
 * One control: a step back, the date, a step forward. The date is the label as
 * well as the way to change it, so there is nothing to read twice — a separate
 * range caption said what the field beside it already showed. Where the trip
 * is now is drawn on the calendar itself, in the column marked as today, which
 * is where somebody is already looking.
 *
 * The day used to have no way to reach another date at all, so an event could
 * only be put on one by dragging it there from wherever it landed. A date field
 * rather than steps alone because "the Tuesday after next" is faster to pick
 * than to reach a fortnight at a time.
 */
export function DayNavigator({ view, anchor, tripStart, tripEnd, onChange }: DayNavigatorProps) {
  const step = view === 'month' ? 28 : view === 'week' ? 7 : 1;
  const display = useCalendarDisplaySettings();
  const bounded = view === 'week' && tripStart && tripEnd;
  const move = (day: DayKey) =>
    onChange(bounded ? clampDay(day, tripStart, tripEnd) : day);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/*
        One joined control rather than three loose ones. The steps belong to
        the date they step through, and the field's own borders are what
        separate the three, so the group reads as a single dial.
      */}
      <div role="group" aria-label="Date navigation" className="inline-flex shrink-0 items-center">
        <IconButton
          label="Earlier"
          size="sm"
          variant="secondary"
          isDisabled={Boolean(bounded && anchor <= tripStart)}
          onPress={() => move(addDays(anchor, -step))}
          className="rounded-r-none border-r-0 shadow-none before:inset-0"
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>

        <label>
          <span className="sr-only">Go to a date</span>
          <input
            type="date"
            data-testid="go-to-date"
            value={anchor}
            min={bounded ? tripStart : undefined}
            max={bounded ? tripEnd : undefined}
            onChange={(e) => e.target.value && move(e.target.value)}
            className={cn(
              // Fixed rather than intrinsic: a bounded field (the week's, which
              // carries min and max) is drawn narrower than an unbounded one,
              // so switching view shifted the arrows sideways.
              'h-7 w-33 rounded-none border border-line-default bg-card px-2 text-xs text-ink',
              // Above its neighbours, so a focused field's ring is not clipped
              // by the button sitting on top of its edge.
              'focus:relative focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
            )}
          />
        </label>

        <IconButton
          label="Later"
          size="sm"
          variant="secondary"
          isDisabled={Boolean(bounded && anchor >= tripEnd)}
          onPress={() => move(addDays(anchor, step))}
          className="rounded-l-none border-l-0 shadow-none before:inset-0"
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>

      {view === 'week' && (
        <details className="relative">
          <summary className="h-7 cursor-pointer rounded-md border border-line-input bg-card px-2 text-xs leading-7 text-ink hover:bg-sunken focus-visible:outline-focus focus-visible:outline-2">
            Display
          </summary>
          {/*
            Over the calendar rather than under it: the week's day names are
            sticky at 30, and this opens right above them.
          */}
          <div className="absolute top-full right-0 z-50 mt-1 flex w-56 flex-col gap-3 rounded-lg border border-line bg-raised p-3 shadow-lg sm:right-auto sm:left-0">
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
                    {formatHourLabel(hour)}
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
                    {hour === 24 ? `${formatHourLabel(24)} (next day)` : formatHourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      )}
    </div>
  );
}
