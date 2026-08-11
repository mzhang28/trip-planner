import { useSyncExternalStore } from 'react';
import { deviceTimezone } from '../lib/api';

export type ZonePreference = 'event' | 'device';

const KEY = 'trip-planner:zone';
const listeners = new Set<() => void>();

let preference: ZonePreference = read();

function read(): ZonePreference {
  try {
    return localStorage.getItem(KEY) === 'device' ? 'device' : 'event';
  } catch {
    return 'event';
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setZonePreference(next: ZonePreference): void {
  preference = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // A preference that does not persist beats one that throws on click.
  }
  for (const listener of listeners) listener();
}

/**
 * Which zone times are shown in.
 *
 * `event` is the default and shows a booking in the zone of the place it
 * happens: a 09:00 entry in Kyoto reads as 09:00 whether you are in Kyoto or at
 * home. That is what a plan is for. `device` shows the same instants in the
 * zone you are actually in, which is what you want when working out whether you
 * can call someone.
 */
export function useZonePreference(): ZonePreference {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => 'event' as const,
  );
}

/** The zone to render a given event in, honouring the preference. */
export function useDisplayZone(): (eventZone: string | undefined, homeZone: string) => string {
  const preferred = useZonePreference();

  return (eventZone, homeZone) =>
    preferred === 'device' ? deviceTimezone() : (eventZone ?? homeZone);
}
