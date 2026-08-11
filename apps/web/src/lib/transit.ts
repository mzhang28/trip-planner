import type { TripEvent } from '@trip/crdt';

export interface TransitCheck {
  /** How long the leg is expected to take. */
  minutes: number;
  /** How long there is between the two events, or null when it cannot be known. */
  gapMinutes: number | null;
  /** True when the journey does not fit in the gap. */
  tooTight: boolean;
  /** How much is missing, when it is too tight. */
  shortBy: number;
}

/**
 * Whether there is time to get from one event to the next.
 *
 * The gap runs from the end of the earlier event to the start of the later one,
 * so an activity that lasts two hours does not lend that time to the journey
 * after it. An event with no duration is treated as instant, which is the
 * assumption that errs towards saying there is room rather than towards
 * crying wolf.
 *
 * Nothing is reported unless both the journey and the two times are known:
 * warning about a gap that has not been decided yet would fire on every event
 * as it is being typed in.
 */
export function checkTransit(
  event: TripEvent,
  previous: TripEvent | undefined,
): TransitCheck | null {
  const leg = event.transitIn;
  if (!leg || leg.minutes <= 0) return null;

  if (
    !previous ||
    previous.startsAt === undefined ||
    event.startsAt === undefined ||
    event.startsAt < previous.startsAt
  ) {
    return { minutes: leg.minutes, gapMinutes: null, tooTight: false, shortBy: 0 };
  }

  const previousEnds = previous.startsAt + (previous.durationMinutes ?? 0) * 60_000;
  const gapMinutes = Math.round((event.startsAt - previousEnds) / 60_000);

  return {
    minutes: leg.minutes,
    gapMinutes,
    tooTight: gapMinutes < leg.minutes,
    shortBy: Math.max(0, leg.minutes - gapMinutes),
  };
}

const MODE_VERB: Record<string, string> = {
  walk: 'Walk',
  transit: 'Train or bus',
  drive: 'Drive',
  fly: 'Fly',
};

export function describeTransit(event: TripEvent): string | null {
  const leg = event.transitIn;
  if (!leg) return null;

  return `${MODE_VERB[leg.mode] ?? 'Travel'} ${leg.minutes} min`;
}
