import type { FlightDetails, TripEvent } from '@trip/crdt';
import { TextField } from '@trip/ui';
import { formatTime, setTimeOfDay } from '../lib/time';

export interface FlightFieldsProps {
  event: TripEvent;
  homeTimezone: string;
  onPatch: (patch: { flight: FlightDetails }) => void;
}

/**
 * A flight, with each end kept in its own zone.
 *
 * This is the one case where showing a single time zone actively misleads: a
 * flight that leaves at 17:00 and lands at 09:00 has not gone backwards, and
 * showing both ends in the reader's zone would hide the thing they need to
 * plan around.
 */
export function FlightFields({ event, homeTimezone, onPatch }: FlightFieldsProps) {
  const flight = event.flight ?? {};
  const departsTz = flight.departsTz ?? event.timezone ?? homeTimezone;
  const arrivesTz = flight.arrivesTz ?? departsTz;

  const patch = (next: Partial<FlightDetails>) => onPatch({ flight: { ...flight, ...next } });

  return (
    <section className="flex flex-col gap-4">
      <span className="text-xs font-medium text-ink-secondary">Flight</span>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Airline"
          defaultValue={flight.airline ?? ''}
          placeholder="ANA"
          onBlur={(e) => patch({ airline: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Flight number"
          defaultValue={flight.number ?? ''}
          placeholder="NH017"
          onBlur={(e) => patch({ number: e.currentTarget.value.trim().toUpperCase() || undefined })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <span className="text-2xs font-medium tracking-wide text-ink-muted uppercase">Out</span>
          <TextField
            label="Leaving from"
            defaultValue={flight.from ?? ''}
            placeholder="NRT"
            onBlur={(e) => patch({ from: e.currentTarget.value.trim().toUpperCase() || undefined })}
          />
          <TextField
            label={`Departs (${departsTz})`}
            defaultValue={flight.departsAt ? formatTime(flight.departsAt, departsTz) : ''}
            placeholder="17:05"
            onBlur={(e) => {
              const raw = e.currentTarget.value.trim();
              if (!raw) return patch({ departsAt: undefined });
              const at = setTimeOfDay(flight.departsAt ?? event.startsAt ?? Date.now(), departsTz, raw);
              if (at !== null) patch({ departsAt: at, departsTz });
            }}
          />
          <TextField
            label="Departure time zone"
            defaultValue={flight.departsTz ?? ''}
            placeholder={homeTimezone}
            onBlur={(e) => patch({ departsTz: e.currentTarget.value.trim() || undefined })}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <span className="text-2xs font-medium tracking-wide text-ink-muted uppercase">In</span>
          <TextField
            label="Arriving at"
            defaultValue={flight.to ?? ''}
            placeholder="ITM"
            onBlur={(e) => patch({ to: e.currentTarget.value.trim().toUpperCase() || undefined })}
          />
          <TextField
            label={`Arrives (${arrivesTz})`}
            defaultValue={flight.arrivesAt ? formatTime(flight.arrivesAt, arrivesTz) : ''}
            placeholder="09:20"
            onBlur={(e) => {
              const raw = e.currentTarget.value.trim();
              if (!raw) return patch({ arrivesAt: undefined });
              const at = setTimeOfDay(flight.arrivesAt ?? flight.departsAt ?? Date.now(), arrivesTz, raw);
              if (at !== null) patch({ arrivesAt: at, arrivesTz });
            }}
          />
          <TextField
            label="Arrival time zone"
            defaultValue={flight.arrivesTz ?? ''}
            placeholder={departsTz}
            onBlur={(e) => patch({ arrivesTz: e.currentTarget.value.trim() || undefined })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Seat"
          defaultValue={flight.seat ?? ''}
          placeholder="32A"
          onBlur={(e) => patch({ seat: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Terminal"
          defaultValue={flight.terminal ?? ''}
          placeholder="1"
          onBlur={(e) => patch({ terminal: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Gate"
          defaultValue={flight.gate ?? ''}
          placeholder="12"
          onBlur={(e) => patch({ gate: e.currentTarget.value.trim() || undefined })}
        />
      </div>
    </section>
  );
}

/**
 * The flight as it reads on a boarding pass: both airports, both local times,
 * and how much the clock changes in between.
 */
export function FlightSummary({ event, homeTimezone }: { event: TripEvent; homeTimezone: string }) {
  const flight = event.flight;
  if (!flight?.from && !flight?.to) return null;

  const departsTz = flight.departsTz ?? event.timezone ?? homeTimezone;
  const arrivesTz = flight.arrivesTz ?? departsTz;

  const shift =
    flight.departsAt !== undefined && flight.arrivesAt !== undefined
      ? offsetHours(flight.arrivesAt, arrivesTz) - offsetHours(flight.departsAt, departsTz)
      : null;

  return (
    <div
      data-testid="flight-summary"
      className="tabular flex items-center gap-3 rounded-md border border-line bg-sunken px-3 py-2 text-xs"
    >
      <span className="font-medium text-ink">{flight.from ?? '???'}</span>
      <span className="text-ink-muted">
        {flight.departsAt ? formatTime(flight.departsAt, departsTz) : '--:--'}
      </span>

      <span aria-hidden="true" className="flex-1 border-t border-dashed border-line-strong" />
      <span className="sr-only">to</span>

      <span className="text-ink-muted">
        {flight.arrivesAt ? formatTime(flight.arrivesAt, arrivesTz) : '--:--'}
      </span>
      <span className="font-medium text-ink">{flight.to ?? '???'}</span>

      {shift !== null && shift !== 0 && (
        <span className="text-2xs text-ink-muted">
          clocks {shift > 0 ? 'forward' : 'back'} {Math.abs(shift)}h
        </span>
      )}
    </div>
  );
}

/** How far ahead of UTC a zone is at that instant, in whole hours. */
function offsetHours(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));

  return Math.round((asIfUtc - at) / 3_600_000);
}
