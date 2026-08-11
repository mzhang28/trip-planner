import { describe, expect, it } from 'vitest';
import { dayKey } from '../lib/time';
import { parseDate } from './dates';

const TOKYO = 'Asia/Tokyo';
const LA = 'America/Los_Angeles';

// A Friday.
const NOW = Date.UTC(2026, 7, 14, 3, 0);

function on(input: string, zone = TOKYO, now = NOW): string | null {
  const parsed = parseDate(input, zone, now);
  return parsed ? dayKey(parsed.at, zone) : null;
}

describe('parseDate', () => {
  it('reads the relative words', () => {
    expect(on('today')).toBe('2026-08-14');
    expect(on('tomorrow')).toBe('2026-08-15');
    expect(on('yesterday')).toBe('2026-08-13');
  });

  it('reads a month and a day in either order, with or without a year', () => {
    expect(on('aug 20')).toBe('2026-08-20');
    expect(on('20 aug')).toBe('2026-08-20');
    expect(on('august 20')).toBe('2026-08-20');
    expect(on('20th august')).toBe('2026-08-20');
    expect(on('aug 20 2027')).toBe('2027-08-20');
  });

  it('reads an ISO date', () => {
    expect(on('2026-12-25')).toBe('2026-12-25');
  });

  it('reads a weekday as the next one, counting today as itself', () => {
    // 14 August 2026 is a Friday.
    expect(on('friday')).toBe('2026-08-14');
    expect(on('saturday')).toBe('2026-08-15');
    expect(on('monday')).toBe('2026-08-17');
  });

  it('reads "next" on the same weekday as a week away', () => {
    expect(on('next friday')).toBe('2026-08-21');
    // On any other day "next" and the plain form agree.
    expect(on('next monday')).toBe('2026-08-17');
  });

  it('lands on the right day in a zone behind UTC as well as ahead of it', () => {
    // The same instant is still the 13th in Los Angeles and the 14th in Tokyo,
    // so "today" has to be read in the zone rather than in UTC.
    expect(on('today', LA)).toBe('2026-08-13');
    expect(on('today', TOKYO)).toBe('2026-08-14');
    expect(on('2026-08-20', LA)).toBe('2026-08-20');
  });

  it('gives back nothing rather than a guess', () => {
    for (const input of ['', 'fushimi', 'augu', '32 aug', 'aug', 'the 14th', 'nishiki market']) {
      expect(parseDate(input, TOKYO, NOW), input).toBeNull();
    }
  });

  it('says what it understood, so a misread is visible', () => {
    expect(parseDate('aug 20', TOKYO, NOW)?.label).toContain('20 Aug 2026');
    expect(parseDate('today', TOKYO, NOW)?.label).toMatch(/^Today,/);
  });
});
