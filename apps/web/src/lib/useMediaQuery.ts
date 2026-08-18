import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * A phone: narrower than Tailwind's `sm`, and the width at which the itinerary
 * needs the whole screen. Written as a query rather than a class because the
 * things that go at this width -- the map, the search row -- cost bandwidth or
 * space even while hidden, so they are left out of the tree instead.
 */
export const PHONE = '(max-width: 39.999rem)';

/**
 * Whether the viewport matches a CSS media query.
 *
 * A Tailwind class can hide something at a width, but a hidden element is still
 * mounted and still fetches whatever it fetches. This answers the question in
 * JavaScript, so a component that costs bandwidth can be left out of the tree
 * entirely at the widths where it is not worth its space.
 */
export function useMediaQuery(query: string): boolean {
  const list = useMemo(() => window.matchMedia(query), [query]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [list],
  );

  return useSyncExternalStore(
    subscribe,
    () => list.matches,
    () => false,
  );
}
