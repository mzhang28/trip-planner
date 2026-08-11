import type { FlightDetails, TripEvent } from '@trip/crdt';
import { TextField } from '@trip/ui';
import { formatTime, setTimeOfDay } from '../lib/time';
import { TimeField } from './TimeField';

export interface FlightFieldsProps {
  event: TripEvent;
  homeTimezone: string;
  onPatch: (patch: Partial<TripEvent>) => void;
}

/**
 * A flight, with each end shown in its own zone.
 *
 * The departure is the event's start and the arrival is start plus duration.
 * Keeping one timeline is essential: calendar placement, transit checks, and
 * the boarding-pass summary must not be able to disagree about one flight.
 */
export function FlightFields({ event, homeTimezone, onPatch }: FlightFieldsProps) {
  const flight = event.flight ?? {};
  const departsTz = flight.departsTz ?? event.timezone ?? homeTimezone;
  const arrivesTz = flight.arrivesTz ?? departsTz;
  const arrivesAt =
    event.startsAt === undefined || event.durationMinutes === undefined
      ? undefined
      : event.startsAt + event.durationMinutes * 60_000;

  const patchFlight = (next: Partial<FlightDetails>) =>
    onPatch({ flight: { ...flight, ...next } });

  function setDeparture(raw: string): string | null {
    if (raw === '') {
      onPatch({ startsAt: undefined });
      return null;
    }

    const at = setTimeOfDay(event.startsAt ?? Date.now(), departsTz, raw);
    if (at === null) return 'Use a 24-hour time, like 17:05';

    onPatch({
      startsAt: at,
      // A flight's event time is its departure, so the event's zone belongs
      // to the departure airport too.
      timezone: departsTz,
      flight: { ...flight, departsTz },
    });
    return null;
  }

  function setArrival(raw: string): string | null {
    if (event.startsAt === undefined) return 'Set the departure time first.';
    if (raw === '') {
      onPatch({ durationMinutes: undefined });
      return null;
    }

    let at = setTimeOfDay(event.startsAt, arrivesTz, raw);
    if (at === null) return 'Use a 24-hour time, like 09:20';

    // A time earlier than departure is normally tomorrow at the arrival
    // airport. This gives overnight flights the useful default while retaining
    // a single start + duration for the calendar.
    if (at <= event.startsAt) at += 24 * 60 * 60 * 1000;

    onPatch({
      durationMinutes: Math.round((at - event.startsAt) / 60_000),
      flight: { ...flight, arrivesTz },
    });
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <span className="text-xs font-medium text-ink-secondary">Flight</span>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Airline"
          defaultValue={flight.airline ?? ''}
          placeholder="ANA"
          onBlur={(e) => patchFlight({ airline: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Flight number"
          defaultValue={flight.number ?? ''}
          placeholder="NH017"
          onBlur={(e) =>
            patchFlight({ number: e.currentTarget.value.trim().toUpperCase() || undefined })
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <span className="text-2xs font-medium tracking-wide text-ink-muted uppercase">Out</span>
          <TextField
            label="Leaving from"
            defaultValue={flight.from ?? ''}
            placeholder="NRT"
            onBlur={(e) => patchFlight({ from: e.currentTarget.value.trim().toUpperCase() || undefined })}
          />
          <TimeField
            label={`Departs (${departsTz})`}
            value={event.startsAt === undefined ? '' : formatTime(event.startsAt, departsTz)}
            onCommit={setDeparture}
          />
          <TextField
            label="Departure time zone"
            defaultValue={flight.departsTz ?? ''}
            placeholder={homeTimezone}
            onBlur={(e) => {
              const timezone = e.currentTarget.value.trim() || undefined;
              patchFlight({ departsTz: timezone });
              onPatch({ timezone });
            }}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <span className="text-2xs font-medium tracking-wide text-ink-muted uppercase">In</span>
          <TextField
            label="Arriving at"
            defaultValue={flight.to ?? ''}
            placeholder="ITM"
            onBlur={(e) => patchFlight({ to: e.currentTarget.value.trim().toUpperCase() || undefined })}
          />
          <TimeField
            label={`Arrives (${arrivesTz})`}
            value={arrivesAt === undefined ? '' : formatTime(arrivesAt, arrivesTz)}
            disabled={event.startsAt === undefined}
            hint={event.startsAt === undefined ? 'Set the departure time first.' : undefined}
            onCommit={setArrival}
          />
          <TextField
            label="Arrival time zone"
            defaultValue={flight.arrivesTz ?? ''}
            placeholder={departsTz}
            onBlur={(e) => patchFlight({ arrivesTz: e.currentTarget.value.trim() || undefined })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Seat"
          defaultValue={flight.seat ?? ''}
          placeholder="32A"
          onBlur={(e) => patchFlight({ seat: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Terminal"
          defaultValue={flight.terminal ?? ''}
          placeholder="1"
          onBlur={(e) => patchFlight({ terminal: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Gate"
          defaultValue={flight.gate ?? ''}
          placeholder="12"
          onBlur={(e) => patchFlight({ gate: e.currentTarget.value.trim() || undefined })}
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

  const departsAt = event.startsAt;
  const arrivesAt =
    event.startsAt === undefined || event.durationMinutes === undefined
      ? undefined
      : event.startsAt + event.durationMinutes * 60_000;

  const shift =
    departsAt !== undefined && arrivesAt !== undefined
      ? offsetHours(arrivesAt, arrivesTz) - offsetHours(departsAt, departsTz)
      : null;

  return (
    <div
      data-testid="flight-summary"
      className="tabular flex items-center gap-3 rounded-md border border-line bg-sunken px-3 py-2 text-xs"
    >
      <span className="font-medium text-ink">{flight.from ?? '???'}</span>
      <span className="text-ink-muted">
        {departsAt ? formatTime(departsAt, departsTz) : '--:--'}
      </span>

      <span aria-hidden="true" className="flex-1 border-t border-dashed border-line-strong" />
      <span className="sr-only">to</span>

      <span className="text-ink-muted">
        {arrivesAt ? formatTime(arrivesAt, arrivesTz) : '--:--'}
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
