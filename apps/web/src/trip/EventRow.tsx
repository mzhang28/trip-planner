import type {
  CustomValue,
  EventAttachment,
  FieldDef,
  FieldDefId,
  TripDoc,
  TripEvent,
} from '@trip/crdt';
import { Card, StatusChip, StatusSpine, cn } from '@trip/ui';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { formatTime } from '../lib/time';
import { useDisplayZone } from './useDisplayZone';
import { EventDetails } from './EventDetails';
import { EventEditor } from './EventEditor';
import { FlightSummary } from './FlightFields';

export interface EventRowProps {
  event: TripEvent;
  homeTimezone: string;
  fieldDefs: FieldDef[];
  readOnly: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onAddLink: (url: string, title: string | undefined) => void;
  onRemoveLink: (linkId: string) => void;
  onSetCustomField: (fieldId: FieldDefId, value: CustomValue | undefined) => void;
  onAddAttachment: (id: string, attachment: EventAttachment) => void;
  onRemoveAttachment: (id: string) => void;
  onDelete: () => void;
  doc: TripDoc | undefined;
  onOpenEvent: (eventId: string) => void;
  /**
   * Held by the list rather than by the card.
   *
   * Setting a time moves the event to another day, which re-parents the card
   * and would reset state living here -- so the editor would snap shut at the
   * moment someone finished typing into it.
   */
  isOpen: boolean;
  onToggle: () => void;
  /** Fields asked for during this sitting, held by the list for the same reason. */
  revealed: ReadonlySet<string>;
  onReveal: (key: string) => void;
  isSelected: boolean;
  onToggleSelected: () => void;
  /** Once anything is ticked, every card shows its box. */
  selectionActive: boolean;
  /** Rendered as the grip. Absent for a viewer, who cannot move anything. */
  dragHandle?: ReactNode;
}

/**
 * One event, which opens in place when clicked.
 *
 * Editing happens on the card rather than in a dialog. Most edits here are one
 * field -- a time, a status -- and sending someone to another surface and back
 * for that costs more attention than the edit does.
 */
export function EventRow({
  event,
  homeTimezone,
  fieldDefs,
  readOnly,
  onPatch,
  onAddLink,
  onRemoveLink,
  onSetCustomField,
  onAddAttachment,
  onRemoveAttachment,
  onDelete,
  doc,
  onOpenEvent,
  isOpen,
  revealed,
  onReveal,
  onToggle,
  isSelected,
  onToggleSelected,
  selectionActive,
  dragHandle,
}: EventRowProps) {
  const displayZone = useDisplayZone();
  const zone = displayZone(event.timezone, homeTimezone);
  // An event on a day with no hour yet reads the same as one with no day: the
  // card says nothing about when, and the day it sits under says the rest.
  const time =
    event.startsAt === undefined || event.timeUndecided ? null : formatTime(event.startsAt, zone);

  const linkCount = Object.keys(event.links).length;
  const summary = [
    event.city,
    event.location?.label,
    linkCount > 0 ? `${linkCount} link${linkCount === 1 ? '' : 's'}` : undefined,
  ].filter(Boolean);

  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <StatusSpine status={event.booking.status} />

        {!readOnly && (
          <label
            className={cn(
              'flex cursor-pointer items-center pl-2',
              /*
               * Hidden until something is ticked or the card is hovered, so a
               * list of events is a list of events rather than a form -- but
               * only where hovering is a thing. A finger has no hover, so on a
               * phone the boxes were invisible and selection unreachable.
               */
              !selectionActive &&
                !isSelected &&
                '[@media(hover:hover)]:opacity-0 focus-within:opacity-100 hover:opacity-100',
            )}
          >
            <span className="sr-only">Select {event.name}</span>
            <input
              type="checkbox"
              data-testid="event-select"
              checked={isSelected}
              onChange={onToggleSelected}
              className="size-4 accent-[var(--accent)]"
            />
          </label>
        )}

        {dragHandle}

        <Button
          data-testid="event"
          onPress={onToggle}
          aria-expanded={isOpen}
          className={cn(
            'flex flex-1 items-center gap-3 px-3 py-2.5 text-left',
            'data-hovered:bg-sunken data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:-outline-offset-2',
          )}
        >
          <span className="tabular w-11 shrink-0 text-xs text-ink-muted">{time ?? '--:--'}</span>

          <span className="min-w-0 flex-1">
            {/* An event made by picking a day is real before it is named. */}
            <span
              className={cn(
                'block truncate text-sm font-medium',
                event.name ? 'text-ink' : 'text-ink-placeholder italic',
              )}
            >
              {event.name || 'Unnamed'}
            </span>
            {summary.length > 0 && (
              <span className="block truncate text-2xs text-ink-muted">{summary.join(' · ')}</span>
            )}
          </span>

          <StatusChip status={event.booking.status} short />
        </Button>
      </div>

      {event.kind === 'flight' && (
        <div className="px-3 pb-2">
          <FlightSummary event={event} homeTimezone={homeTimezone} />
        </div>
      )}

      {isOpen && readOnly && (
        <EventDetails
          event={event}
          homeTimezone={homeTimezone}
          zone={zone}
          fieldDefs={fieldDefs}
          doc={doc}
          onOpenEvent={onOpenEvent}
        />
      )}

      {isOpen && !readOnly && (
        <EventEditor
          event={event}
          homeTimezone={homeTimezone}
          fieldDefs={fieldDefs}
          onPatch={onPatch}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onSetCustomField={onSetCustomField}
          onAddAttachment={onAddAttachment}
          onRemoveAttachment={onRemoveAttachment}
          onDelete={onDelete}
          doc={doc}
          onOpenEvent={onOpenEvent}
          onClose={onToggle}
          revealed={revealed}
          onReveal={onReveal}
        />
      )}
    </Card>
  );
}
