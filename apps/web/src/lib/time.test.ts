import { describe, expect, it } from 'vitest';
import {
  clockExample,
  dayKey,
  endTimeFromClock,
  formatDuration,
  formatDayHeading,
  formatHourLabel,
  formatTime,
  moveToDay,
  setTimeOfDay,
  timeZoneAbbreviation,
  timeZoneSearchAbbreviations,
  toTimeInput,
  usesTwelveHourClock,
} from './time';

const TOKYO = 'Asia/Tokyo';
const NEW_YORK = 'America/New_York';

/**
 * `Intl` separates a time from its AM or PM with a narrow no-break space, which
 * is right on screen and unreadable in a test. Every assertion below compares
 * against ordinary spaces.
 */
const spaced = (text: string) => text.replace(/\s/g, ' ');

describe('formatTime', () => {
  const morning = Date.UTC(2026, 7, 14, 0, 30);
  const evening = Date.UTC(2026, 7, 14, 12, 30);

  it('reads as a twelve-hour clock where that is what people use', () => {
    expect(spaced(formatTime(morning, TOKYO, 'en-US'))).toBe('9:30 AM');
    expect(spaced(formatTime(evening, TOKYO, 'en-US'))).toBe('9:30 PM');
  });

  it('reads as a 24-hour clock where that is what people use', () => {
    expect(formatTime(morning, TOKYO, 'en-GB')).toBe('09:30');
    expect(formatTime(evening, TOKYO, 'en-GB')).toBe('21:30');
  });

  it('follows the clock the locale asks for, not the language', () => {
    // A visitor whose device is set to a 24-hour clock says so through the
    // locale, and the app follows it rather than the country it belongs to.
    expect(formatTime(evening, TOKYO, 'en-US-u-hc-h23')).toBe('21:30');
    // British English writes its day period in lower case.
    expect(spaced(formatTime(evening, TOKYO, 'en-GB-u-hc-h12'))).toBe('9:30 pm');
  });

  it('names both ends of the day the way a clock does', () => {
    const midnight = Date.UTC(2026, 7, 13, 15);
    const noon = Date.UTC(2026, 7, 14, 3);

    // Not 24:00, and not 0 AM.
    expect(formatTime(midnight, TOKYO, 'en-GB')).toBe('00:00');
    expect(spaced(formatTime(midnight, TOKYO, 'en-US'))).toBe('12:00 AM');
    expect(spaced(formatTime(noon, TOKYO, 'en-US'))).toBe('12:00 PM');
  });
});

describe('usesTwelveHourClock', () => {
  it('answers from the locale', () => {
    expect(usesTwelveHourClock('en-US')).toBe(true);
    expect(usesTwelveHourClock('en-GB')).toBe(false);
    expect(usesTwelveHourClock('en-US-u-hc-h23')).toBe(false);
  });
});

describe('formatHourLabel', () => {
  it('drops the minutes from a twelve-hour axis, where they say nothing', () => {
    expect(spaced(formatHourLabel(9, 'en-US'))).toBe('9 AM');
    expect(spaced(formatHourLabel(13, 'en-US'))).toBe('1 PM');
  });

  it('keeps a 24-hour axis in the form those clocks are written', () => {
    expect(formatHourLabel(9, 'en-GB')).toBe('09:00');
    expect(formatHourLabel(13, 'en-GB')).toBe('13:00');
  });

  it('labels the hour past the end of the day as midnight', () => {
    expect(formatHourLabel(24, 'en-GB')).toBe('00:00');
    expect(spaced(formatHourLabel(24, 'en-US'))).toBe('12 AM');
  });
});

describe('clockExample', () => {
  it('shows an example somebody can copy without converting it', () => {
    expect(clockExample(17, 30, 'en-GB')).toBe('17:30');
    expect(spaced(clockExample(17, 30, 'en-US'))).toBe('5:30 PM');
  });
});

describe('formatDayHeading', () => {
  it('uses the date order of the selected locale without decorative punctuation', () => {
    const friday = Date.UTC(2026, 7, 21, 12);

    expect(formatDayHeading(friday, 'UTC', 'en-US')).toBe('Friday August 21');
    expect(formatDayHeading(friday, 'UTC', 'en-GB')).toBe('Friday 21 August');
  });
});

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
    expect(toTimeInput(nine!, TOKYO)).toBe('09:00');
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

    expect(toTimeInput(morningBefore, NEW_YORK)).toBe('09:00');
    expect(toTimeInput(morningAfter, NEW_YORK)).toBe('09:00');

    // Same wall clock, different instants: three days apart plus the hour the
    // clocks went back.
    const days = (morningAfter - morningBefore) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(3 + 1 / 24, 5);
  });

  it('refuses anything that is not a time', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    for (const input of ['', 'nine', '25:00', '09:60', '9', '09-00', '13:00 PM', '0:30 AM']) {
      expect(setTimeOfDay(at, TOKYO, input), input).toBeNull();
    }
  });

  it('accepts a single-digit hour', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    expect(toTimeInput(setTimeOfDay(at, TOKYO, '9:05')!, TOKYO)).toBe('09:05');
  });

  it('reads a twelve-hour clock however somebody writes it', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    const clock = (input: string) => toTimeInput(setTimeOfDay(at, TOKYO, input)!, TOKYO);

    expect(clock('9:05 AM')).toBe('09:05');
    expect(clock('9:05 pm')).toBe('21:05');
    expect(clock('9:05 PM')).toBe('21:05');
    expect(clock('9:05pm')).toBe('21:05');
    expect(clock('9:05 p.m.')).toBe('21:05');

    // A bare hour is enough once AM or PM is on it: nothing is half-typed.
    expect(clock('9 PM')).toBe('21:00');
  });

  it('puts midnight and noon where a twelve-hour clock puts them', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    const clock = (input: string) => toTimeInput(setTimeOfDay(at, TOKYO, input)!, TOKYO);

    expect(clock('12:00 AM')).toBe('00:00');
    expect(clock('12:30 PM')).toBe('12:30');
  });

  it('reads back what a field showed, narrow space and all', () => {
    // The editors put `formatTime` into the field and hand what comes out of it
    // to `setTimeOfDay`, so anything Intl writes has to survive the return trip.
    const at = Date.UTC(2026, 7, 14, 12, 30);

    for (const locale of ['en-US', 'en-GB']) {
      const shown = formatTime(at, TOKYO, locale);
      expect(toTimeInput(setTimeOfDay(at, TOKYO, shown)!, TOKYO), shown).toBe('21:30');
    }
  });

  it('still reads a 24-hour clock, whichever one the browser shows', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    expect(toTimeInput(setTimeOfDay(at, TOKYO, '21:05')!, TOKYO)).toBe('21:05');
  });
});

describe('endTimeFromClock', () => {
  it('uses the same day when the end is later than the start', () => {
    const start = setTimeOfDay(Date.UTC(2026, 7, 14, 3), TOKYO, '13:15')!;
    const end = endTimeFromClock(start, TOKYO, '21:00')!;

    expect(toTimeInput(end, TOKYO)).toBe('21:00');
    expect((end - start) / 60_000).toBe(465);
  });

  it('uses the following day when the clock is earlier', () => {
    const start = setTimeOfDay(Date.UTC(2026, 7, 14, 3), TOKYO, '23:30')!;
    const end = endTimeFromClock(start, TOKYO, '01:00')!;

    expect(dayKey(end, TOKYO)).not.toBe(dayKey(start, TOKYO));
    expect((end - start) / 60_000).toBe(90);
  });
});

describe('formatDuration', () => {
  it('uses hours and minutes instead of exposing stored minutes', () => {
    expect(formatDuration(465)).toBe('7 hr 45 min');
    expect(formatDuration(120)).toBe('2 hr');
    expect(formatDuration(45)).toBe('45 min');
  });
});

describe('moveToDay', () => {
  it('lands on the target day at the same wall-clock time', () => {
    const at = setTimeOfDay(Date.UTC(2026, 7, 14, 3, 0), TOKYO, '09:00')!;
    const moved = moveToDay(at, TOKYO, '2026-08-17')!;

    expect(dayKey(moved, TOKYO)).toBe('2026-08-17');
    expect(toTimeInput(moved, TOKYO)).toBe('09:00');
  });

  it('keeps the time of day across a daylight-saving change', () => {
    // Dragging from before the change to after it. Shifting by a fixed number
    // of hours instead would land this an hour out.
    const at = setTimeOfDay(Date.UTC(2026, 9, 30, 15, 0), NEW_YORK, '09:00')!;
    const moved = moveToDay(at, NEW_YORK, '2026-11-05')!;

    expect(dayKey(moved, NEW_YORK)).toBe('2026-11-05');
    expect(toTimeInput(moved, NEW_YORK)).toBe('09:00');
  });

  it('refuses anything that is not a calendar day', () => {
    const at = Date.UTC(2026, 7, 14, 3, 0);
    for (const input of ['', 'tomorrow', '2026-8-14', '14/08/2026']) {
      expect(moveToDay(at, TOKYO, input), input).toBeNull();
    }
  });
});

describe('time zone abbreviations', () => {
  const summer = Date.parse('2026-08-12T12:00:00Z');

  it('uses familiar names when Intl only returns a numeric offset', () => {
    expect(timeZoneAbbreviation(summer, TOKYO)).toBe('JST');
    expect(timeZoneAbbreviation(summer, 'Europe/London')).toBe('BST');
  });

  it('search includes both sides of a daylight-saving change', () => {
    expect(timeZoneSearchAbbreviations(summer, NEW_YORK)).toEqual(
      expect.arrayContaining(['EST', 'EDT']),
    );
  });
});
