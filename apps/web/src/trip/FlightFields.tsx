import type { FlightDetails, TripEvent } from '@trip/crdt';
import { useState } from 'react';
import { TextField, cn } from '@trip/ui';
import {
  formatTime,
  isTimeZone,
  knownTimeZones,
  setDay,
  setTimeOfDay,
  toDateInput,
} from '../lib/time';
import { CheckedField } from './CheckedField';
import { TimeField } from './TimeField';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A date control, which is what both ends of a flight were missing. */
function DayField({
  label,
  value,
  testId,
  error,
  onChange,
}: {
  label: string;
  value: string;
  testId: string;
  /** Why the day was refused, which a date control cannot say on its own. */
  error?: string | null;
  onChange: (day: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-secondary">{label}</span>
      <input
        type="date"
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        className={cn(
          'h-9 w-full rounded-md border bg-card px-2.5 text-ink',
          'focus:outline-focus focus:outline-2 focus:-outline-offset-1',
          error ? 'border-danger' : 'border-line-input focus:border-accent',
        )}
      />
      {error && <span className="text-2xs text-danger">{error}</span>}
    </label>
  );
}

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
  // Why an arrival date was refused. The time field says its own piece; a date
  // control has nowhere to put a message.
  const [arrivalProblem, setArrivalProblem] = useState<string | null>(null);
  const flight = event.flight ?? {};
  const departsTz = flight.departsTz ?? event.timezone ?? homeTimezone;
  const arrivesTz = flight.arrivesTz ?? departsTz;
  const arrivesAt =
    event.startsAt === undefined || event.durationMinutes === undefined
      ? undefined
      : event.startsAt + event.durationMinutes * 60_000;

  const patchFlight = (next: Partial<FlightDetails>) =>
    onPatch({ flight: { ...flight, ...next } });

  /** Moves the departure onto a day, keeping its hour if it has one. */
  function setDepartureDay(day: string) {
    if (!day) return onPatch({ startsAt: undefined, timeUndecided: undefined });

    const timed = event.startsAt !== undefined && !event.timeUndecided;
    const at = setDay(timed ? event.startsAt : undefined, departsTz, day);
    if (at === null) return;

    onPatch({
      startsAt: at,
      // A flight's event time is its departure, so the event's zone belongs
      // to the departure airport too.
      timezone: departsTz,
      timeUndecided: timed ? undefined : true,
      flight: { ...flight, departsTz },
    });
  }

  function setDeparture(raw: string): string | null {
    if (raw === '') {
      // The day survives an hour being taken away, the same as anywhere else.
      if (event.startsAt !== undefined) onPatch({ timeUndecided: true });
      return null;
    }

    // Asked for rather than assumed. Typing a time first used to put the
    // flight on today, whatever day the ticket says.
    if (event.startsAt === undefined) return 'Pick the departure date first.';

    const at = setTimeOfDay(event.startsAt, departsTz, raw);
    if (at === null) return 'Use a 24-hour time, like 17:05';

    onPatch({
      startsAt: at,
      timezone: departsTz,
      timeUndecided: undefined,
      flight: { ...flight, departsTz },
    });
    return null;
  }

  /**
   * Writes the arrival as a moment, and keeps it after the departure.
   *
   * The event holds one start and a length, so the arrival is worked out from
   * the two -- but it is entered as a day and an hour at the arrival airport,
   * which is how a ticket reads it.
   */
  function commitArrival(at: number): string | null {
    if (event.startsAt === undefined) return 'Set the departure first.';
    if (at <= event.startsAt) {
      return 'That is before the flight leaves. Check the arrival date.';
    }

    onPatch({
      durationMinutes: Math.round((at - event.startsAt) / 60_000),
      flight: { ...flight, arrivesTz },
    });
    return null;
  }

  function setArrivalDay(day: string) {
    setArrivalProblem(null);
    if (!day) return onPatch({ durationMinutes: undefined });
    if (event.startsAt === undefined) return;

    const clock = formatTime(arrivesAt ?? event.startsAt, arrivesTz);
    const onDay = setDay(undefined, arrivesTz, day);
    const at = onDay === null ? null : setTimeOfDay(onDay, arrivesTz, clock);
    if (at !== null) setArrivalProblem(commitArrival(at));
  }

  function setArrival(raw: string): string | null {
    if (event.startsAt === undefined) return 'Set the departure time first.';
    if (raw === '') {
      onPatch({ durationMinutes: undefined });
      return null;
    }

    let at = setTimeOfDay(arrivesAt ?? event.startsAt, arrivesTz, raw);
    if (at === null) return 'Use a 24-hour time, like 09:20';

    /*
     * An hour earlier than departure, on the day the flight leaves, means the
     * next morning. Rolling it forward used to be the only way to say so and
     * left no trace; the arrival date beside this now shows the day it landed
     * on, and a flight longer than a day is set there rather than worked
     * around.
     */
    if (at <= event.startsAt && arrivesAt === undefined) at += DAY_MS;

    return commitArrival(at);
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
          <DayField
            label="Departure date"
            testId="departs-date"
            value={event.startsAt === undefined ? '' : toDateInput(event.startsAt, departsTz)}
            onChange={setDepartureDay}
          />
          <TimeField
            label={`Departs (${departsTz})`}
            value={
              event.startsAt === undefined || event.timeUndecided
                ? ''
                : formatTime(event.startsAt, departsTz)
            }
            onCommit={setDeparture}
          />
          <CheckedField
            label="Departure time zone"
            value={flight.departsTz ?? ''}
            placeholder={homeTimezone}
            suggestions={knownTimeZones()}
            onCommit={(raw) => {
              if (raw !== '' && !isTimeZone(raw)) {
                // An unknown zone here used to be stored and then throw from
                // Intl every time the flight was drawn.
                return 'Not a time zone. Try one from the list, like Asia/Tokyo.';
              }

              const timezone = raw || undefined;
              patchFlight({ departsTz: timezone });
              onPatch({ timezone });
              return null;
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
          <DayField
            label="Arrival date"
            testId="arrives-date"
            value={arrivesAt === undefined ? '' : toDateInput(arrivesAt, arrivesTz)}
            error={arrivalProblem}
            onChange={setArrivalDay}
          />
          <TimeField
            label={`Arrives (${arrivesTz})`}
            value={arrivesAt === undefined ? '' : formatTime(arrivesAt, arrivesTz)}
            disabled={event.startsAt === undefined}
            hint={event.startsAt === undefined ? 'Set the departure time first.' : undefined}
            onCommit={setArrival}
          />
          <CheckedField
            label="Arrival time zone"
            value={flight.arrivesTz ?? ''}
            placeholder={departsTz}
            suggestions={knownTimeZones()}
            onCommit={(raw) => {
              if (raw !== '' && !isTimeZone(raw)) {
                return 'Not a time zone. Try one from the list, like Asia/Tokyo.';
              }

              patchFlight({ arrivesTz: raw || undefined });
              return null;
            }}
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
