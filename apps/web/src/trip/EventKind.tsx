import type { EventKind } from '@trip/crdt';
import { BedDouble, CalendarDays, Plane, StickyNote, type LucideIcon } from 'lucide-react';

/**
 * `activity` is the backward-compatible document value. In the interface it is
 * the ordinary, general-purpose Event kind.
 */
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  activity: 'Event',
  lodging: 'Stay',
  flight: 'Flight',
  note: 'Note',
};

export const EVENT_KIND_OPTIONS = (
  ['activity', 'lodging', 'flight', 'note'] as const
).map((value) => ({ value, label: EVENT_KIND_LABEL[value] }));

const EVENT_KIND_ICON: Record<EventKind, LucideIcon> = {
  activity: CalendarDays,
  lodging: BedDouble,
  flight: Plane,
  note: StickyNote,
};

export function EventKindIcon({ kind, className }: { kind: EventKind; className?: string }) {
  const Icon = EVENT_KIND_ICON[kind];

  return (
    <Icon
      role="img"
      aria-label={EVENT_KIND_LABEL[kind]}
      data-testid="event-kind-icon"
      data-event-kind={kind}
      className={className ?? 'size-4'}
    />
  );
}
