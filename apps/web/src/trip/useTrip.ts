import type { TripDoc, TripEvent } from '@trip/crdt';
import { liveEvents } from '@trip/crdt';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { TripStore, type TripState } from './TripStore';

/** Opens a trip's replica and keeps it open for as long as it is on screen. */
export function useTripStore(tripId: string | undefined): TripStore | null {
  const [store, setStore] = useState<TripStore | null>(null);

  useEffect(() => {
    if (!tripId) {
      setStore(null);
      return;
    }

    let live = true;
    let opened: TripStore | null = null;

    void TripStore.open(tripId).then((store) => {
      opened = store;
      if (live) setStore(store);
      else store.dispose();
    });

    return () => {
      live = false;
      opened?.dispose();
    };
  }, [tripId]);

  return store;
}

const EMPTY: TripState | null = null;

export function useTripState(store: TripStore | null): TripState | null {
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => EMPTY),
    () => EMPTY,
  );
}

/** Events that are not tombstoned, earliest first, unscheduled ones last. */
export function useEvents(state: TripState | null): TripEvent[] {
  return useMemo(() => {
    if (!state) return [];

    return liveEvents(state.doc as TripDoc).sort((a, b) => {
      if (a.startsAt === undefined && b.startsAt === undefined) {
        return a.name.localeCompare(b.name);
      }
      // Something with no time yet is still being worked out, so it belongs at
      // the end of the day rather than at midnight.
      if (a.startsAt === undefined) return 1;
      if (b.startsAt === undefined) return -1;
      return a.startsAt - b.startsAt;
    });
  }, [state]);
}
