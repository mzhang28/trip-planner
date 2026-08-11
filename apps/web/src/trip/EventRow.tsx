import type { CustomValue, FieldDef, FieldDefId, TripEvent } from '@trip/crdt';
import { Card, StatusChip, StatusSpine, cn } from '@trip/ui';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { formatTime } from '../lib/time';
import { useDisplayZone } from './useDisplayZone';
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
  onDelete: () => void;
  /**
   * Held by the list rather than by the card.
   *
   * Setting a time moves the event to another day, which re-parents the card
   * and would reset state living here -- so the editor would snap shut at the
   * moment someone finished typing into it.
   */
  isOpen: boolean;
  onToggle: () => void;
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
  onDelete,
  isOpen,
  onToggle,
  dragHandle,
}: EventRowProps) {
  const displayZone = useDisplayZone();
  const zone = displayZone(event.timezone, homeTimezone);
  const time = event.startsAt === undefined ? null : formatTime(event.startsAt, zone);

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
        {dragHandle}

        <Button
          data-testid="event"
          onPress={onToggle}
          isDisabled={readOnly}
          aria-expanded={isOpen}
          className={cn(
            'flex flex-1 items-center gap-3 px-3 py-2.5 text-left',
            'data-hovered:bg-sunken data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:-outline-offset-2',
            readOnly && 'cursor-default',
          )}
        >
          <span className="tabular w-11 shrink-0 text-xs text-ink-muted">{time ?? '--:--'}</span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{event.name}</span>
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

      {isOpen && !readOnly && (
        <EventEditor
          event={event}
          homeTimezone={homeTimezone}
          fieldDefs={fieldDefs}
          onPatch={onPatch}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onSetCustomField={onSetCustomField}
          onDelete={onDelete}
        />
      )}
    </Card>
  );
}
