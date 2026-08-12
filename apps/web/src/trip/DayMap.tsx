import type { TripEvent } from '@trip/crdt';
import { boldColor, parseColor, readableTextColor } from '@trip/ui';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface DayMapProps {
  events: TripEvent[];
  selectedId: string | null;
  onSelect: (eventId: string) => void;
}

/**
 * Pins share the card's status colour, so a pin and its card are visibly one
 * thing rather than two lists that happen to be about the same trip.
 */
const STATUS_COLOR: Record<string, string> = {
  booked: 'var(--status-booked)',
  idea: 'var(--status-idea)',
};

/** Numbered in the order the day happens, which is how the timeline reads. */
function pinIcon(index: number, status: string, selected: boolean, color?: string): L.DivIcon {
  // Only validated palette-shaped values enter the HTML string.
  const custom = color && parseColor(color) ? boldColor(color) : undefined;
  const background = custom ?? STATUS_COLOR[status] ?? 'var(--status-idea)';
  const foreground = custom ? readableTextColor(custom) : 'var(--surface-card)';

  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:50%;
      background:${background};
      color:${foreground};
      font:600 12px/1 var(--font-sans);
      box-shadow:${selected ? '0 0 0 3px var(--accent)' : 'var(--depth-md)'};
    ">${index + 1}</span>`,
  });
}

/**
 * The day's places, beside the day's timeline.
 *
 * Built against Leaflet directly rather than through a React wrapper: the map
 * owns a piece of the DOM and its own lifecycle, and letting React re-create
 * that on every render is how a map ends up flickering or leaking tile layers.
 */
export function DayMap({ events, selectedId, onSelect }: DayMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());

  const pinned = events.filter(
    (event) => event.location?.lat !== undefined && event.location.lng !== undefined,
  );
  const hasPins = pinned.length > 0;

  /*
   * Runs when the container appears, not only when this component mounts. A day
   * that starts with nothing pinned has no container to build a map in, so an
   * effect that only ran once left the panel empty for the rest of the visit:
   * the first place added to a day got no map at all.
   */
  useEffect(() => {
    if (!container.current || map.current) return;

    map.current = L.map(container.current, { zoomControl: true, attributionControl: true }).setView(
      [35.68, 139.69],
      12,
    );

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Raster tiles, so the service worker can keep the ones already looked at
      // and a day viewed before still shows its map with no signal.
      attribution: '© OpenStreetMap contributors',
    }).addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, [hasPins]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();

    pinned.forEach((event, index) => {
      const marker = L.marker([event.location!.lat!, event.location!.lng!], {
        icon: pinIcon(index, event.booking.status, event.id === selectedId, event.color),
        title: event.name,
        alt: `${index + 1}. ${event.name}`,
      })
        .addTo(instance)
        .on('click', () => onSelect(event.id));

      markers.current.set(event.id, marker);
    });

    if (pinned.length > 0) {
      const bounds = L.latLngBounds(
        pinned.map((event) => [event.location!.lat!, event.location!.lng!] as [number, number]),
      );
      instance.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    /*
     * `pinned` is a new array every render, so depending on it directly would
     * redraw the map continuously. This key holds everything a marker is drawn
     * from: which events, in what order, where, and how they look. It used to
     * hold only ids and booking states, so moving a pinned place left the old
     * marker where it was, and reordering a day left the numbers as they were.
     */
  }, [
    pinned
      .map(
        (event, index) =>
          `${event.id}:${index}:${event.booking.status}:${event.color ?? ''}:${event.location!.lat}:${event.location!.lng}`,
      )
      .join(),
    selectedId,
  ]);

  /*
   * Out of the way until there is something to look at. An empty map panel took
   * half the width of a desktop and a screen of a phone to repeat one sentence
   * for as long as nothing had a place -- which is most of the time a trip is
   * being planned.
   */
  if (pinned.length === 0) {
    return (
      <p
        data-testid="empty-map"
        className="rounded-lg border border-dashed border-line px-3 py-2 text-2xs text-ink-muted"
      >
        Give an event a place and the map appears here, with a numbered pin in the order the day
        happens.
      </p>
    );
  }

  return (
    <div
      ref={container}
      data-testid="day-map"
      role="application"
      aria-label="Map of this day"
      className="h-full min-h-0 w-full rounded-lg border border-line sm:min-h-64"
    />
  );
}
