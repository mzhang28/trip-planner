import type { CustomValue, FieldDef, FieldDefId, TripEvent } from '@trip/crdt';
import { Card, StatusChip, StatusSpine, cn } from '@trip/ui';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from 'react-aria-components';
import { formatTime, zoneFor } from '../lib/time';
import { EventEditor } from './EventEditor';

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
  dragHandle,
}: EventRowProps) {
  const [open, setOpen] = useState(false);
  const zone = zoneFor(event.timezone, homeTimezone);
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
          onPress={() => setOpen((was) => !was)}
          isDisabled={readOnly}
          aria-expanded={open}
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

      {open && !readOnly && (
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
