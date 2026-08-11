import { describe, expect, it } from 'vitest';
import { dayKey, formatTime, setTimeOfDay } from './time';

const TOKYO = 'Asia/Tokyo';
const NEW_YORK = 'America/New_York';

describe('dayKey', () => {
  it('gives the local calendar day, not the UTC one', () => {
    // 23:30 in Tokyo on 14 August is still 14:30 UTC on the same date, but
    // 09:30 in Tokyo on the 15th is the 15th in Tokyo and the 14th in UTC.
    const late = Date.UTC(2026, 7, 14, 14, 30);
    expect(dayKey(late, TOKYO)).toBe('2026-08-14');

    const earlyNextDay = Date.UTC(2026, 7, 14, 22, 0);
    expect(dayKey(earlyNextDay, TOKYO)).toBe('2026-08-15');
    expect(dayKey(earlyNextDay, 'UTC')).toBe('2026-08-14');
  });
});

describe('setTimeOfDay', () => {
  it('sets the wall-clock time in the event zone', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    const nine = setTimeOfDay(at, TOKYO, '09:00');

    expect(nine).not.toBeNull();
    expect(formatTime(nine!, TOKYO)).toBe('09:00');
    expect(dayKey(nine!, TOKYO)).toBe(dayKey(at, TOKYO));
  });

  it('holds the wall-clock time across a daylight-saving change', () => {
    // New York moves off daylight time on 1 November 2026. Nine in the morning
    // is nine in the morning on both sides of it, even though the offset from
    // UTC differs, which is why the offset is measured rather than assumed.
    const before = Date.UTC(2026, 9, 30, 15, 0);
    const after = Date.UTC(2026, 10, 2, 15, 0);

    const morningBefore = setTimeOfDay(before, NEW_YORK, '09:00')!;
    const morningAfter = setTimeOfDay(after, NEW_YORK, '09:00')!;

    expect(formatTime(morningBefore, NEW_YORK)).toBe('09:00');
    expect(formatTime(morningAfter, NEW_YORK)).toBe('09:00');

    // Same wall clock, different instants: three days apart plus the hour the
    // clocks went back.
    const days = (morningAfter - morningBefore) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(3 + 1 / 24, 5);
  });

  it('refuses anything that is not a time', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    for (const input of ['', 'nine', '25:00', '09:60', '9', '09-00']) {
      expect(setTimeOfDay(at, TOKYO, input), input).toBeNull();
    }
  });

  it('accepts a single-digit hour', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    expect(formatTime(setTimeOfDay(at, TOKYO, '9:05')!, TOKYO)).toBe('09:05');
  });
});
