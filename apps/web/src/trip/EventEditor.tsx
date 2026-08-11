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
import {
  formatTime,
  isTimeZone,
  knownTimeZones,
  setDay,
  setTimeOfDay,
  toDateInput,
  zoneFor,
} from '../lib/time';
import { CheckedField } from './CheckedField';
import { TimeField } from './TimeField';
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
  /** Closes the card. The header that also closes it scrolls out of reach. */
  onClose: () => void;
  /**
   * Fields asked for during this sitting, kept by the list.
   *
   * Setting a date moves the event to another day's section, which re-parents
   * this card and throws away anything held here -- so every field somebody had
   * just opened vanished at the moment the date landed.
   */
  revealed: ReadonlySet<string>;
  onReveal: (key: string) => void;
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
  onClose,
  revealed,
  onReveal,
}: EventEditorProps) {
  const zone = zoneFor(event.timezone, homeTimezone);
  const time =
    event.startsAt === undefined || event.timeUndecided ? '' : formatTime(event.startsAt, zone);

  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);


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
        key: 'when',
        label: 'Date',
        filled: event.startsAt !== undefined,
        render: () => (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-secondary">Date</span>
              {/*
                A real date control, not a text box that guessed. Entering a
                time used to put the event on today whatever day was meant,
                which on a trip planner is the one thing that must not be
                guessed.
              */}
              <input
                type="date"
                data-testid="event-date"
                value={event.startsAt === undefined ? '' : toDateInput(event.startsAt, zone)}
                onChange={(e) => {
                  const day = e.target.value;
                  if (!day) return onPatch({ startsAt: undefined, timeUndecided: undefined });

                  // A day on its own is a day on its own. Whether the hour is
                  // known does not change by picking a date, so an event that
                  // had a time keeps it and one that had none still has none.
                  const timed = event.startsAt !== undefined && !event.timeUndecided;
                  const next = setDay(timed ? event.startsAt : undefined, zone, day);

                  if (next !== null) {
                    onPatch({
                      startsAt: next,
                      timezone: zone,
                      timeUndecided: timed ? undefined : true,
                    });
                  }
                }}
                className={cn(
                  'h-9 w-full rounded-md border border-line-input bg-card px-2.5 text-ink',
                  'focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
                )}
              />
            </label>

            <TimeField
              label={`Time (${zone})`}
              value={time}
              disabled={event.startsAt === undefined}
              hint={
                event.startsAt === undefined
                  ? 'Pick a date first.'
                  : event.timeUndecided
                    ? 'Not set. The day is enough until you know the hour.'
                    : 'Leave blank while you are still working out when.'
              }
              onCommit={(raw) => {
                if (raw === '') {
                  // Keeps the day, drops the time of day, which is the state an
                  // event is in before anyone has decided the hour.
                  const day = toDateInput(event.startsAt!, zone);
                  const next = setDay(undefined, zone, day);
                  if (next === null) return 'That is not a time';

                  onPatch({ startsAt: next, timeUndecided: true });
                  return null;
                }

                const next = setTimeOfDay(event.startsAt ?? Date.now(), zone, raw);
                if (next === null) return 'Use a 24-hour time, like 09:00';

                onPatch({ startsAt: next, timezone: zone, timeUndecided: undefined });
                return null;
              }}
            />
          </div>
        ),
      },
      {
        key: 'duration',
        label: 'How long',
        filled: event.durationMinutes !== undefined,
        render: () => (
          <CheckedField
            label="How long"
            inputMode="numeric"
            placeholder="90"
            hint="In minutes."
            value={event.durationMinutes === undefined ? '' : String(event.durationMinutes)}
            onCommit={(raw) => {
              if (raw === '') {
                onPatch({ durationMinutes: undefined });
                return null;
              }

              // A negative or fractional length used to be stored as typed, and
              // then drew an event of negative height on the week grid.
              const minutes = Number(raw);
              if (!Number.isInteger(minutes) || minutes <= 0) {
                return 'A whole number of minutes, more than zero.';
              }

              onPatch({ durationMinutes: minutes });
              return null;
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
                errorMessage={linkError}
                onChange={(next) => {
                  setLinkUrl(next);
                  setLinkError(null);
                }}
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
              <Button size="sm" onPress={addLink}>
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
          <CheckedField
            label="Time zone"
            placeholder={homeTimezone}
            hint="Where this happens. Leave blank to use the trip's."
            value={event.timezone ?? ''}
            suggestions={knownTimeZones()}
            onCommit={(raw) => {
              if (raw === '') {
                onPatch({ timezone: undefined });
                return null;
              }

              /*
               * Checked here rather than where it is printed. An unknown zone
               * used to be stored happily and then throw from Intl every time
               * the event was drawn, which reads as the app breaking rather
               * than as one field being wrong.
               */
              if (!isTimeZone(raw)) return 'Not a time zone. Try one from the list, like Asia/Tokyo.';

              onPatch({ timezone: raw });
              return null;
            }}
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
        render: () => {
          /*
           * Date controls rather than text boxes, and read in the zone of the
           * place. Typing a date built an instant at 15:00 UTC, which is the
           * previous evening in Tokyo -- so a stay drawn along the bottom of
           * the week began a day early.
           */
          const stay = event.lodging;
          const checkIn = stay?.checkIn;
          const checkOut = stay?.checkOut;
          const wrongWayRound =
            checkIn !== undefined && checkOut !== undefined && checkOut <= checkIn;

          return (
            <div className="flex flex-col gap-1">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-secondary">Check in</span>
                  <input
                    type="date"
                    data-testid="check-in"
                    value={checkIn === undefined ? '' : toDateInput(checkIn, zone)}
                    onChange={(e) => {
                      const day = e.target.value;
                      const at = day ? setTimeOfDay(setDay(undefined, zone, day)!, zone, '15:00') : undefined;
                      onPatch({ lodging: { ...stay, checkIn: at ?? undefined } });
                    }}
                    className={cn(
                      'h-9 w-full rounded-md border border-line-input bg-card px-2.5 text-ink',
                      'focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1',
                    )}
                  />
                  <span className="text-2xs text-ink-muted">Shown along the bottom of the week.</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-secondary">Check out</span>
                  <input
                    type="date"
                    data-testid="check-out"
                    value={checkOut === undefined ? '' : toDateInput(checkOut, zone)}
                    min={checkIn === undefined ? undefined : toDateInput(checkIn, zone)}
                    onChange={(e) => {
                      const day = e.target.value;
                      const at = day ? setTimeOfDay(setDay(undefined, zone, day)!, zone, '10:00') : undefined;
                      onPatch({ lodging: { ...stay, checkOut: at ?? undefined } });
                    }}
                    className={cn(
                      'h-9 w-full rounded-md border bg-card px-2.5 text-ink',
                      'focus:outline-focus focus:outline-2 focus:-outline-offset-1',
                      wrongWayRound ? 'border-danger' : 'border-line-input focus:border-accent',
                    )}
                  />
                  <span className="text-2xs text-ink-muted">The day you leave, not the last night.</span>
                </label>
              </div>

              {wrongWayRound && (
                <p className="text-2xs text-danger">
                  You would be leaving before you arrive. Check the dates over.
                </p>
              )}
            </div>
          );
        },
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

  /**
   * Reads what was typed as a web address, or says why it cannot.
   *
   * Anything at all used to be accepted, so `fushimi-inari.jp` became a link to
   * a page of this app that does not exist. A bare host is what people type, so
   * it is completed rather than rejected.
   */
  function readAddress(typed: string): { url: string } | { error: string } {
    const text = typed.trim();
    if (text === '') return { error: 'Paste or type an address first.' };

    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      return { error: 'That is not a web address. It should look like example.com/page.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only web addresses, starting http:// or https://.' };
    }

    // A host with no dot is a machine name on a local network, not a site.
    if (!parsed.hostname.includes('.')) {
      return { error: 'That address has no site in it, like example.com.' };
    }

    return { url: parsed.toString() };
  }

  function addLink() {
    const read = readAddress(linkUrl);
    if ('error' in read) return setLinkError(read.error);

    onAddLink(read.url, linkTitle.trim() || undefined);
    setLinkUrl('');
    setLinkTitle('');
    setLinkError(null);
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
      <CheckedField
        label="Name"
        value={event.name}
        placeholder="What is it?"
        /*
         * An event made by picking a day on the calendar has no name yet, and
         * naming it is the only thing left to do -- so the cursor is already
         * there rather than one click away.
         */
        autoFocus={event.name === ''}
        onCommit={(raw) => {
          /*
           * Emptying a name was refused without a word, and the old name came
           * back when the editor closed. An event that has never been named is
           * a different thing -- the calendar makes those on purpose -- so
           * nothing is said about one of those.
           */
          if (raw === '' && event.name !== '') {
            return 'An event needs a name. Delete it below if you no longer want it.';
          }

          if (raw !== event.name) onPatch({ name: raw });
          return null;
        }}
      />

      {shown.map((section) => (
        <div key={section.key} data-testid={`field-${section.key}`}>
          {section.render()}
        </div>
      ))}

      <FieldPalette
        chips={chips}
        onAdd={onReveal}
      />

      {/*
        Sticky, because an event with most of its fields open is several screens
        tall on a phone and the card header -- the only way out -- is at the top
        of them. The name comes along so it is clear what is being edited.
      */}
      <div className="sticky bottom-0 -mx-3 -mb-4 flex items-center gap-3 border-t border-line bg-card px-3 py-2">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            event.name ? 'text-ink-secondary' : 'text-ink-placeholder italic',
          )}
        >
          {event.name || 'Unnamed'}
        </span>

        {/* Said in full to a screen reader, short on a phone where it sits
            beside the name it applies to. */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Delete event"
          onPress={onDelete}
          className={cn('text-danger')}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
        <Button size="sm" data-testid="close-editor" onPress={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
