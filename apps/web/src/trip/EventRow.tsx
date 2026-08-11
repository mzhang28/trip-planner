import { BOOKING_STATUSES, type BookingStatus, type TripEvent } from '@trip/crdt';
import { Card, SegmentedControl, StatusChip, StatusSpine, TextField, cn } from '@trip/ui';
import { useState } from 'react';
import { Button } from 'react-aria-components';
import { formatTime, setTimeOfDay, zoneFor } from '../lib/time';

const STATUS_OPTIONS = BOOKING_STATUSES.map((status) => ({
  value: status,
  label: { idea: 'Idea', in_progress: 'Holding', booked: 'Booked' }[status],
}));

export interface EventRowProps {
  event: TripEvent;
  homeTimezone: string;
  readOnly: boolean;
  onRename: (name: string) => void;
  onSetTime: (startsAt: number | undefined) => void;
  onSetStatus: (status: BookingStatus) => void;
  onDelete: () => void;
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
  readOnly,
  onRename,
  onSetTime,
  onSetStatus,
  onDelete,
}: EventRowProps) {
  const [open, setOpen] = useState(false);
  const zone = zoneFor(event.timezone, homeTimezone);
  const time = event.startsAt === undefined ? null : formatTime(event.startsAt, zone);

  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <StatusSpine status={event.booking.status} />

        <Button
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
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{event.name}</span>
          <StatusChip status={event.booking.status} short />
        </Button>
      </div>

      {open && !readOnly && (
        <div className="flex flex-col gap-4 border-t border-line px-3 py-3">
          <TextField
            label="Name"
            defaultValue={event.name}
            onBlur={(e) => {
              const next = e.currentTarget.value.trim();
              if (next && next !== event.name) onRename(next);
            }}
          />

          <TextField
            label={`Start time (${zone})`}
            defaultValue={time ?? ''}
            placeholder="09:00"
            description="Leave blank while you are still working out when."
            onBlur={(e) => {
              const raw = e.currentTarget.value.trim();
              if (raw === '') {
                onSetTime(undefined);
                return;
              }
              // Anchor to the event's own day if it has one, otherwise today.
              const anchor = event.startsAt ?? Date.now();
              const next = setTimeOfDay(anchor, zone, raw);
              if (next !== null) onSetTime(next);
            }}
          />

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">Booking</span>
            <SegmentedControl
              label="Booking status"
              options={STATUS_OPTIONS}
              value={event.booking.status}
              onChange={onSetStatus}
            />
          </div>

          <div className="flex justify-end">
            <Button
              onPress={onDelete}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-danger data-hovered:bg-danger-soft data-focus-visible:outline-focus data-focus-visible:outline-2"
            >
              Delete event
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
