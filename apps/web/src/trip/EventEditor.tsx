import type { BookingStatus, CustomValue, FieldDef, FieldDefId, TripEvent } from '@trip/crdt';
import { BOOKING_STATUSES } from '@trip/crdt';
import { Button, CustomFieldInput, SegmentedControl, TextField, cn } from '@trip/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatTime, setTimeOfDay, zoneFor } from '../lib/time';
import { PlacePicker } from './PlacePicker';

const STATUS_OPTIONS = BOOKING_STATUSES.map((status) => ({
  value: status,
  label: { idea: 'Idea', in_progress: 'Holding', booked: 'Booked' }[status],
}));

export interface EventEditorProps {
  event: TripEvent;
  homeTimezone: string;
  fieldDefs: FieldDef[];
  onPatch: (patch: Record<string, unknown>) => void;
  onAddLink: (url: string, title: string | undefined) => void;
  onRemoveLink: (linkId: string) => void;
  onSetCustomField: (fieldId: FieldDefId, value: CustomValue | undefined) => void;
  onDelete: () => void;
}

/**
 * Everything an event can carry, once someone wants to fill it in.
 *
 * Ordered by how early each thing tends to be known: what and where first, then
 * when, then whether it is settled, then the paperwork. Nothing is required, so
 * an event with only a name is a complete event rather than an unfinished one.
 */
export function EventEditor({
  event,
  homeTimezone,
  fieldDefs,
  onPatch,
  onAddLink,
  onRemoveLink,
  onSetCustomField,
  onDelete,
}: EventEditorProps) {
  const zone = zoneFor(event.timezone, homeTimezone);
  const time = event.startsAt === undefined ? '' : formatTime(event.startsAt, zone);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

  const applicable = fieldDefs.filter(
    (def) => !def.appliesTo || def.appliesTo.includes(event.kind),
  );

  function addLink() {
    const url = linkUrl.trim();
    if (!url) return;
    onAddLink(url, linkTitle.trim() || undefined);
    setLinkUrl('');
    setLinkTitle('');
  }

  return (
    <div data-testid="event-editor" className="flex flex-col gap-5 border-t border-line px-3 py-4">
      <TextField
        label="Name"
        defaultValue={event.name}
        onBlur={(e) => {
          const next = e.currentTarget.value.trim();
          if (next && next !== event.name) onPatch({ name: next });
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="City"
          defaultValue={event.city ?? ''}
          placeholder="Kyoto"
          description="Groups the day in month view."
          onBlur={(e) => onPatch({ city: e.currentTarget.value.trim() || undefined })}
        />

        <PlacePicker
          value={event.location}
          onChange={(location) => onPatch({ location })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={`Start time (${zone})`}
          defaultValue={time}
          placeholder="09:00"
          description="Leave blank while you are still working out when."
          onBlur={(e) => {
            const raw = e.currentTarget.value.trim();
            if (raw === '') {
              onPatch({ startsAt: undefined });
              return;
            }
            const next = setTimeOfDay(event.startsAt ?? Date.now(), zone, raw);
            if (next !== null) onPatch({ startsAt: next, timezone: zone });
          }}
        />

        <TextField
          label="How long"
          inputMode="numeric"
          defaultValue={event.durationMinutes === undefined ? '' : String(event.durationMinutes)}
          placeholder="90"
          description="In minutes."
          onBlur={(e) => {
            const raw = e.currentTarget.value.trim();
            const parsed = Number(raw);
            onPatch({
              durationMinutes: raw === '' || Number.isNaN(parsed) ? undefined : parsed,
            });
          }}
        />
      </div>

      <TextField
        label="Time zone"
        defaultValue={event.timezone ?? ''}
        placeholder={homeTimezone}
        description="Where this happens. Leave blank to use the trip's."
        onBlur={(e) => onPatch({ timezone: e.currentTarget.value.trim() || undefined })}
      />

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-secondary">Booking</span>
        <SegmentedControl
          label="Booking status"
          options={STATUS_OPTIONS}
          value={event.booking.status}
          onChange={(status: BookingStatus) =>
            onPatch({ booking: { ...event.booking, status } })
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Confirmation code"
            defaultValue={event.booking.confirmationCode ?? ''}
            placeholder="7K2QLM"
            onBlur={(e) =>
              onPatch({
                booking: {
                  ...event.booking,
                  confirmationCode: e.currentTarget.value.trim() || undefined,
                },
              })
            }
          />
          <TextField
            label="Note"
            defaultValue={event.booking.note ?? ''}
            placeholder="Deposit paid, balance on arrival"
            onBlur={(e) =>
              onPatch({
                booking: { ...event.booking, note: e.currentTarget.value.trim() || undefined },
              })
            }
          />
        </div>
      </div>

      <TextField
        label="Description"
        multiline
        defaultValue={event.description ?? ''}
        placeholder="Go before the coaches arrive"
        onBlur={(e) => onPatch({ description: e.currentTarget.value.trim() || undefined })}
      />

      <section className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-secondary">Links</span>

        {Object.entries(event.links).length > 0 && (
          <ul className="flex flex-col gap-1">
            {Object.entries(event.links).map(([linkId, link]) => (
              <li key={linkId} className="flex items-center gap-2">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate text-xs text-accent-text underline underline-offset-2"
                >
                  {link.title ?? link.url}
                </a>
                <button
                  type="button"
                  aria-label={`Remove ${link.title ?? link.url}`}
                  onClick={() => onRemoveLink(linkId)}
                  className="text-ink-muted hover:text-danger focus-visible:outline-focus focus-visible:outline-2"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Address"
            labelHidden
            type="url"
            className="min-w-40 flex-1"
            placeholder="https://…"
            value={linkUrl}
            onChange={setLinkUrl}
          />
          <TextField
            label="Title"
            labelHidden
            className="min-w-32 flex-1"
            placeholder="What is it"
            value={linkTitle}
            onChange={setLinkTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addLink();
            }}
          />
          <Button size="sm" onPress={addLink} isDisabled={linkUrl.trim() === ''}>
            <Plus className="size-3.5" />
            Add link
          </Button>
        </div>
      </section>

      {applicable.length > 0 && (
        <section className="flex flex-col gap-4">
          <span className="text-xs font-medium text-ink-secondary">This trip’s fields</span>
          {applicable.map((def) => (
            <CustomFieldInput
              key={def.id}
              def={def}
              value={event.customFields[def.id]}
              onChange={(value) => onSetCustomField(def.id, value)}
            />
          ))}
        </section>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onPress={onDelete} className={cn('text-danger')}>
          <Trash2 className="size-3.5" />
          Delete event
        </Button>
      </div>
    </div>
  );
}
