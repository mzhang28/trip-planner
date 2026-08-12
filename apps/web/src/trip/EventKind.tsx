import type { EventKind, TransitMethod } from '@trip/crdt';
import {
  BedDouble,
  BusFront,
  Car,
  CalendarDays,
  Plane,
  Route,
  Ship,
  StickyNote,
  TrainFront,
  type LucideIcon,
} from 'lucide-react';

/**
 * `activity` is the backward-compatible document value. In the interface it is
 * the ordinary, general-purpose Event kind.
 */
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  activity: 'Event',
  lodging: 'Stay',
  transit: 'Transit',
  note: 'Note',
};

export const EVENT_KIND_OPTIONS = (['activity', 'lodging', 'transit', 'note'] as const).map(
  (value) => ({ value, label: EVENT_KIND_LABEL[value] }),
);

const EVENT_KIND_ICON: Record<EventKind, LucideIcon> = {
  activity: CalendarDays,
  lodging: BedDouble,
  transit: BusFront,
  note: StickyNote,
};

export const TRANSIT_METHOD_LABEL: Record<TransitMethod, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  car: 'Car',
  ferry: 'Ferry',
  other: 'Other',
};

// A transit event wears the icon of how it is made, so a flight still shows a
// plane and a ferry a ship, now that they are all one kind.
const TRANSIT_METHOD_ICON: Record<TransitMethod, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: BusFront,
  car: Car,
  ferry: Ship,
  other: Route,
};

export function EventKindIcon({
  kind,
  method,
  className,
}: {
  kind: EventKind;
  /** For a transit event, which method's icon to show. */
  method?: TransitMethod;
  className?: string;
}) {
  const Icon = kind === 'transit' && method ? TRANSIT_METHOD_ICON[method] : EVENT_KIND_ICON[kind];
  const label =
    kind === 'transit' && method ? TRANSIT_METHOD_LABEL[method] : EVENT_KIND_LABEL[kind];

  return (
    <Icon
      role="img"
      aria-label={label}
      data-testid="event-kind-icon"
      data-event-kind={kind}
      className={className ?? 'size-4'}
    />
  );
}
