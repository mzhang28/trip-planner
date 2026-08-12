import type { CustomValue, FieldDef, TripDoc, TripEvent } from '@trip/crdt';
import { renderCustomValue, type FieldDefId } from '@trip/crdt';
import { StatusChip, coloredSurfaceStyle } from '@trip/ui';
import { Paperclip } from 'lucide-react';
import { formatTime } from '../lib/time';
import { Description } from './DescriptionEditor';
import { FlightSummary } from './FlightFields';
import { describeTransit } from '../lib/transit';
import { TransitSummary } from './TransitFields';

export interface EventDetailsProps {
  event: TripEvent;
  homeTimezone: string;
  zone: string;
  fieldDefs: FieldDef[];
  cityColors?: Record<string, string>;
  doc: TripDoc | undefined;
  onOpenEvent: (eventId: string) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      <dt className="w-28 shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function CustomValueDisplay({ value, def }: { value: CustomValue; def: FieldDef }) {
  if (value.kind !== 'options') return renderCustomValue(value, def);

  return (
    <span className="flex flex-wrap gap-1.5">
      {Object.keys(value.selected).map((optionId) => {
        const option = def.options?.[optionId];
        if (!option) return <span key={optionId}>{optionId}</span>;

        return (
          <span
            key={optionId}
            style={coloredSurfaceStyle(option.color)}
            className={
              option.color
                ? 'rounded-full border px-2.5 py-0.5 text-xs'
                : 'rounded-full border border-line-default px-2.5 py-0.5 text-xs text-ink-secondary'
            }
          >
            {option.label}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Everything an event holds, without any way to change it.
 *
 * A viewer used to be locked out of the card entirely, so a share meant to be
 * an itinerary showed a name, a time, and nothing else -- not the booking
 * reference, the address, or the flight, which are the parts somebody actually
 * on the trip needs. Read-only is a reason to hide the controls, not the
 * content.
 */
export function EventDetails({
  event,
  homeTimezone,
  zone,
  fieldDefs,
  cityColors,
  doc,
  onOpenEvent,
}: EventDetailsProps) {
  const links = Object.values(event.links);
  const files = Object.values(event.attachments);
  const transit = describeTransit(event);

  const customs = fieldDefs
    .map((def) => ({ def, value: event.customFields[def.id as FieldDefId] }))
    .filter((entry) => entry.value !== undefined);

  return (
    <dl
      data-testid="event-details"
      className="flex flex-col gap-2 border-t border-line px-3 py-3"
    >
      <Row label="When">
        {event.startsAt === undefined
          ? 'Not scheduled yet'
          : `${new Intl.DateTimeFormat('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: zone,
            }).format(event.startsAt)} · ${
              event.timeUndecided ? 'time not set' : formatTime(event.startsAt, zone)
            }${event.durationMinutes ? ` · ${event.durationMinutes} min` : ''}`}
      </Row>

      {(event.city || event.location?.label) && (
        <Row label="Where">
          {event.location?.label}
          {event.location?.label && event.city && ' · '}
          {event.city && (
            <span
              style={coloredSurfaceStyle(cityColors?.[event.city])}
              className={cityColors?.[event.city] ? 'rounded-full px-2 py-0.5 text-xs' : undefined}
            >
              {event.city}
            </span>
          )}
          {event.location?.address && (
            <span className="block text-xs text-ink-muted">{event.location.address}</span>
          )}
        </Row>
      )}

      <Row label="Booking">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip status={event.booking.status} />
          {event.booking.confirmationCode && (
            <span className="tabular text-xs">{event.booking.confirmationCode}</span>
          )}
        </span>
        {event.booking.note && (
          <span className="block text-xs text-ink-secondary">{event.booking.note}</span>
        )}
      </Row>

      {transit && <Row label="Getting here">{transit}</Row>}

      {event.kind === 'flight' && (
        <Row label="Flight">
          <FlightSummary event={event} homeTimezone={homeTimezone} />
        </Row>
      )}

      {event.kind === 'transit' && (
        <Row label="Route">
          <TransitSummary event={event} />
        </Row>
      )}

      {event.description && (
        <Row label="Notes">
          <Description text={event.description} doc={doc} onOpenEvent={onOpenEvent} />
        </Row>
      )}

      {links.length > 0 && (
        <Row label="Links">
          <ul className="flex flex-col gap-0.5">
            {links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-accent-text underline underline-offset-2"
                >
                  {link.title ?? link.url}
                </a>
              </li>
            ))}
          </ul>
        </Row>
      )}

      {files.length > 0 && (
        <Row label="Files">
          <ul className="flex flex-col gap-0.5">
            {files.map((file) => (
              <li key={file.blobHash} className="flex items-center gap-1.5">
                <Paperclip aria-hidden="true" className="size-3 text-ink-muted" />
                <a
                  href={`/api/blobs/${file.blobHash}?mime=${encodeURIComponent(file.mime)}`}
                  download={file.filename}
                  className="text-xs text-accent-text underline underline-offset-2"
                >
                  {file.filename}
                </a>
              </li>
            ))}
          </ul>
        </Row>
      )}

      {customs.map(({ def, value }) => (
        <Row key={def.id} label={def.label}>
          <CustomValueDisplay value={value!} def={def} />
        </Row>
      ))}
    </dl>
  );
}
