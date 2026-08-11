import { useSyncExternalStore } from 'react';

export interface CalendarDisplaySettings {
  /** First hour shown in the week timetable, in 24-hour time. */
  weekStartHour: number;
  /** End of the displayed range; 24 means midnight at the end of the day. */
  weekEndHour: number;
  /** Compress the configured hours into the available Week view height. */
  weekFitToView: boolean;
}

const KEY = 'trip-planner:calendar-display';
const DEFAULT: CalendarDisplaySettings = {
  weekStartHour: 9,
  weekEndHour: 24,
  weekFitToView: true,
};
const listeners = new Set<() => void>();

function read(): CalendarDisplaySettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as
      | Partial<CalendarDisplaySettings>
      | null;
    const start = value?.weekStartHour;
    const end = value?.weekEndHour;
    if (
      typeof start === 'number' &&
      typeof end === 'number' &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end <= 24 &&
      start < end
    ) {
      return {
        weekStartHour: start,
        weekEndHour: end,
        // Existing saved settings predate this option. They should receive the
        // new default rather than unexpectedly retaining the old scroll.
        weekFitToView: value?.weekFitToView !== false,
      };
    }
  } catch {
    // A broken preference should never keep somebody out of their calendar.
  }
  return DEFAULT;
}

let settings = read();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCalendarDisplaySettings(next: CalendarDisplaySettings): void {
  if (next.weekStartHour < 0 || next.weekEndHour > 24 || next.weekStartHour >= next.weekEndHour) {
    return;
  }

  settings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The in-memory setting still improves this visit when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function useCalendarDisplaySettings(): CalendarDisplaySettings {
  return useSyncExternalStore(subscribe, () => settings, () => DEFAULT);
}
