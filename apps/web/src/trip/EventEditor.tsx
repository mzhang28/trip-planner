import type {
  BookingStatus,
  CustomValue,
  EventAttachment,
  FieldDef,
  FieldDefId,
  TripDoc,
  TripEvent,
} from '@trip/crdt';
import { BOOKING_STATUSES } from '@trip/crdt';
import { Button, CustomFieldInput, SegmentedControl, TextField, cn } from '@trip/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { formatTime, setTimeOfDay, zoneFor } from '../lib/time';
import { Attachments } from './Attachments';
import { DescriptionEditor } from './DescriptionEditor';
import { FieldPalette, type PaletteChip } from './FieldPalette';
import { FlightFields } from './FlightFields';
import { PlacePicker } from './PlacePicker';

const STATUS_OPTIONS = BOOKING_STATUSES.map((status) => ({
  value: status,
  label: { idea: 'Idea', in_progress: 'Holding', booked: 'Booked' }[status],
}));

const KIND_OPTIONS = [
  { value: 'activity', label: 'Thing to do' },
  { value: 'lodging', label: 'Stay' },
  { value: 'flight', label: 'Flight' },
  { value: 'note', label: 'Note' },
] as const;

const TRANSIT_MODES = [
  { value: 'walk', label: 'Walk' },
  { value: 'transit', label: 'Train' },
  { value: 'drive', label: 'Drive' },
  { value: 'fly', label: 'Fly' },
] as const;

export interface EventEditorProps {
  event: TripEvent;
  homeTimezone: string;
  fieldDefs: FieldDef[];
  onPatch: (patch: Record<string, unknown>) => void;
  onAddLink: (url: string, title: string | undefined) => void;
  onRemoveLink: (linkId: string) => void;
  onSetCustomField: (fieldId: FieldDefId, value: CustomValue | undefined) => void;
  onAddAttachment: (id: string, attachment: EventAttachment) => void;
  onRemoveAttachment: (id: string) => void;
  onDelete: () => void;
  doc: TripDoc | undefined;
  onOpenEvent: (eventId: string) => void;
}

interface Section {
  key: string;
  label: string;
  /** Whether this event has something in it, and so shows without asking. */
  filled: boolean;
  render: () => ReactNode;
}

/**
 * What is known about an event, and a way to say more.
 *
 * A trip is planned in the order things get decided: a name over dinner, a day
 * next week, a booking reference when it arrives. So the editor shows what has
 * been filled in and offers the rest as chips rather than laying out every box
 * at once — which would make an event that is only a name look unfinished, and
 * would bury the two fields that matter under twenty that do not.
 *
 * A field appears once it holds something, or once its chip is clicked, and
 * clearing it does not make it vanish mid-edit.
 */
export function EventEditor({
  event,
  homeTimezone,
  fieldDefs,
  onPatch,
  onAddLink,
  onRemoveLink,
  onSetCustomField,
  onAddAttachment,
  onRemoveAttachment,
  onDelete,
  doc,
  onOpenEvent,
}: EventEditorProps) {
  const zone = zoneFor(event.timezone, homeTimezone);
  const time = event.startsAt === undefined ? '' : formatTime(event.startsAt, zone);

  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

  /*
   * Asked for during this sitting. Kept separate from what is filled in so a
   * field does not disappear the moment its box is emptied, which would take
   * the cursor with it.
   */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const applicable = fieldDefs.filter(
    (def) => !def.appliesTo || def.appliesTo.includes(event.kind),
  );

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = [
      {
        key: 'kind',
        label: 'Kind',
        filled: event.kind !== 'activity',
        render: () => (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">Kind</span>
            <SegmentedControl
              label="What this is"
              options={KIND_OPTIONS}
              value={event.kind}
              onChange={(kind) => onPatch({ kind })}
            />
          </div>
        ),
      },
      {
        key: 'time',
        label: 'Time',
        filled: event.startsAt !== undefined,
        render: () => (
          <TextField
            label={`Start time (${zone})`}
            defaultValue={time}
            placeholder="09:00"
            onBlur={(e) => {
              const raw = e.currentTarget.value.trim();
              if (raw === '') return onPatch({ startsAt: undefined });

              const next = setTimeOfDay(event.startsAt ?? Date.now(), zone, raw);
              if (next !== null) onPatch({ startsAt: next, timezone: zone });
            }}
          />
        ),
      },
      {
        key: 'duration',
        label: 'How long',
        filled: event.durationMinutes !== undefined,
        render: () => (
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
        ),
      },
      {
        key: 'city',
        label: 'City',
        filled: event.city !== undefined,
        render: () => (
          <TextField
            label="City"
            defaultValue={event.city ?? ''}
            placeholder="Kyoto"
            description="Groups the day in month view."
            onBlur={(e) => onPatch({ city: e.currentTarget.value.trim() || undefined })}
          />
        ),
      },
      {
        key: 'place',
        label: 'Place',
        filled: event.location !== undefined,
        render: () => (
          <PlacePicker value={event.location} onChange={(location) => onPatch({ location })} />
        ),
      },
      {
        key: 'booking',
        label: 'Booking',
        filled: event.booking.status !== 'idea',
        render: () => (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">Booking</span>
            <SegmentedControl
              label="Booking status"
              options={STATUS_OPTIONS}
              value={event.booking.status}
              onChange={(status: BookingStatus) =>
                onPatch({ booking: { ...event.booking, status } })
              }
            />
          </div>
        ),
      },
      {
        key: 'confirmation',
        label: 'Confirmation',
        filled: event.booking.confirmationCode !== undefined,
        render: () => (
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
        ),
      },
      {
        key: 'note',
        label: 'Note',
        filled: event.booking.note !== undefined,
        render: () => (
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
        ),
      },
      {
        key: 'description',
        label: 'Description',
        filled: event.description !== undefined,
        render: () => (
          <DescriptionEditor
            value={event.description ?? ''}
            doc={doc}
            eventId={event.id}
            onChange={(description) => onPatch({ description: description.trim() || undefined })}
            onOpenEvent={onOpenEvent}
          />
        ),
      },
      {
        key: 'links',
        label: 'Links',
        filled: Object.keys(event.links).length > 0,
        render: () => (
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
        ),
      },
      {
        key: 'files',
        label: 'Files',
        filled: Object.keys(event.attachments).length > 0,
        render: () => (
          <Attachments event={event} onAdd={onAddAttachment} onRemove={onRemoveAttachment} />
        ),
      },
      {
        key: 'transit',
        label: 'Getting here',
        filled: event.transitIn !== undefined,
        render: () => (
          <section className="flex flex-col gap-2">
            <span className="text-xs font-medium text-ink-secondary">Getting here</span>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="How long"
                inputMode="numeric"
                defaultValue={event.transitIn ? String(event.transitIn.minutes) : ''}
                placeholder="20"
                description="In minutes, from the event before."
                onBlur={(e) => {
                  const raw = e.currentTarget.value.trim();
                  const minutes = Number(raw);

                  onPatch({
                    transitIn:
                      raw === '' || Number.isNaN(minutes) || minutes <= 0
                        ? undefined
                        : { ...event.transitIn, minutes, mode: event.transitIn?.mode ?? 'walk' },
                  });
                }}
              />

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-secondary">By</span>
                <SegmentedControl
                  label="How you get here"
                  options={TRANSIT_MODES}
                  value={event.transitIn?.mode ?? 'walk'}
                  onChange={(mode) =>
                    onPatch({ transitIn: { minutes: event.transitIn?.minutes ?? 0, mode } })
                  }
                />
              </div>

              <TextField
                label="Note"
                defaultValue={event.transitIn?.note ?? ''}
                placeholder="Change at Kyoto"
                onBlur={(e) =>
                  event.transitIn &&
                  onPatch({
                    transitIn: {
                      ...event.transitIn,
                      note: e.currentTarget.value.trim() || undefined,
                    },
                  })
                }
              />
            </div>
          </section>
        ),
      },
      {
        key: 'timezone',
        label: 'Time zone',
        filled: event.timezone !== undefined,
        render: () => (
          <TextField
            label="Time zone"
            defaultValue={event.timezone ?? ''}
            placeholder={homeTimezone}
            description="Where this happens. Leave blank to use the trip's."
            onBlur={(e) => onPatch({ timezone: e.currentTarget.value.trim() || undefined })}
          />
        ),
      },
    ];

    // A stay and a flight carry their own things, and only ever those.
    if (event.kind === 'lodging') {
      list.push({
        key: 'lodging',
        label: 'Nights',
        filled: true,
        render: () => (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Check in"
              defaultValue={
                event.lodging?.checkIn
                  ? new Date(event.lodging.checkIn).toISOString().slice(0, 10)
                  : ''
              }
              placeholder="2026-08-14"
              description="Shown along the bottom of the week."
              onBlur={(e) => {
                const parsed = Date.parse(`${e.currentTarget.value.trim()}T15:00:00Z`);
                onPatch({
                  lodging: {
                    ...event.lodging,
                    checkIn: Number.isNaN(parsed) ? undefined : parsed,
                  },
                });
              }}
            />
            <TextField
              label="Check out"
              defaultValue={
                event.lodging?.checkOut
                  ? new Date(event.lodging.checkOut).toISOString().slice(0, 10)
                  : ''
              }
              placeholder="2026-08-17"
              description="The day you leave, not the last night."
              onBlur={(e) => {
                const parsed = Date.parse(`${e.currentTarget.value.trim()}T10:00:00Z`);
                onPatch({
                  lodging: {
                    ...event.lodging,
                    checkOut: Number.isNaN(parsed) ? undefined : parsed,
                  },
                });
              }}
            />
          </div>
        ),
      });
    }

    if (event.kind === 'flight') {
      list.push({
        key: 'flight',
        label: 'Flight',
        filled: true,
        render: () => (
          <FlightFields
            event={event}
            homeTimezone={homeTimezone}
            onPatch={(patch) => onPatch(patch)}
          />
        ),
      });
    }

    for (const def of applicable) {
      list.push({
        key: `custom:${def.id}`,
        label: def.label,
        filled: event.customFields[def.id] !== undefined,
        render: () => (
          <CustomFieldInput
            def={def}
            value={event.customFields[def.id]}
            onChange={(value) => onSetCustomField(def.id, value)}
          />
        ),
      });
    }

    return list;
  }, [event, applicable, doc, homeTimezone, linkUrl, linkTitle, zone, time]);

  function addLink() {
    const url = linkUrl.trim();
    if (!url) return;

    onAddLink(url, linkTitle.trim() || undefined);
    setLinkUrl('');
    setLinkTitle('');
  }

  const shown = sections.filter((section) => section.filled || revealed.has(section.key));
  const chips: PaletteChip[] = sections
    .filter((section) => !section.filled && !revealed.has(section.key))
    .map((section) => ({ key: section.key, label: section.label }));

  return (
    <div
      data-testid="event-editor"
      className="flex flex-col gap-5 border-t border-line px-3 py-4"
    >
      <TextField
        label="Name"
        defaultValue={event.name}
        placeholder="What is it?"
        /*
         * An event made by picking a day on the calendar has no name yet, and
         * naming it is the only thing left to do -- so the cursor is already
         * there rather than one click away.
         */
        autoFocus={event.name === ''}
        onBlur={(e) => {
          const next = e.currentTarget.value.trim();
          if (next && next !== event.name) onPatch({ name: next });
        }}
      />

      {shown.map((section) => (
        <div key={section.key} data-testid={`field-${section.key}`}>
          {section.render()}
        </div>
      ))}

      <FieldPalette
        chips={chips}
        onAdd={(key) => setRevealed((current) => new Set(current).add(key))}
      />

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onPress={onDelete} className={cn('text-danger')}>
          <Trash2 className="size-3.5" />
          Delete event
        </Button>
      </div>
    </div>
  );
}
