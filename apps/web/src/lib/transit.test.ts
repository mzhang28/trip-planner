import type { TripEvent } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import { checkTransit, describeTransit } from './transit';

const MINUTE = 60_000;

function event(overrides: Partial<TripEvent>): TripEvent {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'activity',
    name: 'Something',
    booking: { status: 'idea' },
    links: {},
    attachments: {},
    customFields: {},
    updatedAt: 0,
    updatedBy: 'u1',
    ...overrides,
  };
}

const noon = Date.UTC(2026, 7, 14, 12, 0);

describe('checkTransit', () => {
  it('says nothing when no journey has been recorded', () => {
    expect(
      checkTransit(event({ startsAt: noon }), event({ startsAt: noon - 60 * MINUTE })),
    ).toBeNull();
  });

  it('warns when the journey does not fit the gap', () => {
    const previous = event({ startsAt: noon, durationMinutes: 60 });
    const next = event({
      startsAt: noon + 80 * MINUTE,
      transitIn: { minutes: 45, mode: 'transit' },
    });

    // The earlier event runs to 13:00 and the later starts at 13:20, so there
    // are twenty minutes for a forty-five minute journey.
    const check = checkTransit(next, previous)!;
    expect(check.gapMinutes).toBe(20);
    expect(check.tooTight).toBe(true);
    expect(check.shortBy).toBe(25);
  });

  it('measures the gap from when the earlier event ends, not when it starts', () => {
    const previous = event({ startsAt: noon, durationMinutes: 120 });
    const next = event({
      startsAt: noon + 150 * MINUTE,
      transitIn: { minutes: 20, mode: 'walk' },
    });

    // Two and a half hours apart, but the first takes two of them. A long
    // activity does not lend its time to the journey after it.
    expect(checkTransit(next, previous)!.gapMinutes).toBe(30);
    expect(checkTransit(next, previous)!.tooTight).toBe(false);
  });

  it('is content when the journey fits', () => {
    const previous = event({ startsAt: noon, durationMinutes: 30 });
    const next = event({
      startsAt: noon + 120 * MINUTE,
      transitIn: { minutes: 40, mode: 'drive' },
    });

    const check = checkTransit(next, previous)!;
    expect(check.tooTight).toBe(false);
    expect(check.shortBy).toBe(0);
  });

  it('treats an event with no duration as instant', () => {
    const previous = event({ startsAt: noon });
    const next = event({
      startsAt: noon + 30 * MINUTE,
      transitIn: { minutes: 25, mode: 'walk' },
    });

    // Erring towards saying there is room beats crying wolf on every event
    // whose length nobody has filled in.
    expect(checkTransit(next, previous)!.tooTight).toBe(false);
  });

  it('reports the journey but no gap when there is nothing to measure against', () => {
    const alone = event({ startsAt: noon, transitIn: { minutes: 30, mode: 'walk' } });

    for (const previous of [undefined, event({}), event({ startsAt: noon + MINUTE })]) {
      const check = checkTransit(alone, previous)!;
      expect(check.gapMinutes).toBeNull();
      expect(check.tooTight).toBe(false);
    }
  });

  it('says nothing about a journey of no length', () => {
    const previous = event({ startsAt: noon });
    const next = event({ startsAt: noon + MINUTE, transitIn: { minutes: 0, mode: 'walk' } });

    expect(checkTransit(next, previous)).toBeNull();
  });
});

describe('describeTransit', () => {
  it('names the way of getting there', () => {
    expect(describeTransit(event({ transitIn: { minutes: 20, mode: 'walk' } }))).toBe(
      'Walk 20 min',
    );
    expect(describeTransit(event({ transitIn: { minutes: 45, mode: 'transit' } }))).toBe(
      'Train or bus 45 min',
    );
  });

  it('says nothing when there is no journey', () => {
    expect(describeTransit(event({}))).toBeNull();
  });
});
