import type { TripEvent } from '@trip/crdt';
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
  in_progress: 'var(--status-pending)',
  idea: 'var(--status-idea)',
};

/** Numbered in the order the day happens, which is how the timeline reads. */
function pinIcon(index: number, status: string, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:50%;
      background:${STATUS_COLOR[status] ?? 'var(--status-idea)'};
      color:var(--surface-card);
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
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();

    pinned.forEach((event, index) => {
      const marker = L.marker([event.location!.lat!, event.location!.lng!], {
        icon: pinIcon(index, event.booking.status, event.id === selectedId),
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
    // `pinned` is derived from events each render, so depending on it directly
    // would redraw every time. The ids and the selection are what change.
  }, [pinned.map((e) => `${e.id}:${e.booking.status}`).join(), selectedId]);

  if (pinned.length === 0) {
    return (
      <div className="grid h-full min-h-64 place-items-center rounded-lg border border-line bg-card p-6 text-center">
        <p className="max-w-xs text-sm text-ink-secondary">
          Nothing on the map yet. Give an event a place and it gets a pin, numbered in the order the
          day happens.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={container}
      data-testid="day-map"
      role="application"
      aria-label="Map of this day"
      className="h-full min-h-64 w-full rounded-lg border border-line"
    />
  );
}
