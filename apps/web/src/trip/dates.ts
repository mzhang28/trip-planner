import type { Instant } from '@trip/crdt';
import { dayKey } from '../lib/time';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface ParsedDate {
  /** Midday in the given zone, so a day is identified without a time meaning anything. */
  at: Instant;
  /** What was understood, echoed back so the person can see it was read right. */
  label: string;
}

function monthIndex(word: string): number {
  const lower = word.toLowerCase();
  return MONTHS.findIndex((month) => month.startsWith(lower) && lower.length >= 3);
}

function weekdayIndex(word: string): number {
  const lower = word.toLowerCase();
  return WEEKDAYS.findIndex((day) => day.startsWith(lower) && lower.length >= 3);
}

/** Midday avoids a daylight-saving shift moving the result onto the day before. */
function middayOn(year: number, month: number, day: number, timeZone: string): Instant {
  const guess = Date.UTC(year, month, day, 12, 0, 0);

  // Correct for the zone by measuring where that instant actually lands.
  const landed = dayKey(guess, timeZone);
  const wanted = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (landed === wanted) return guess;

  const drift = landed < wanted ? 12 : -12;
  return guess + drift * 60 * 60 * 1000;
}

/** 0 for Sunday, matching the WEEKDAYS order. Read in the zone, not in UTC. */
function weekdayInZone(at: Instant, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(at);
  return WEEKDAYS.indexOf(name.toLowerCase());
}

function label(at: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(at);
}

/**
 * Reads the ways a person actually types a date into a search box.
 *
 * Deliberately narrow about what it accepts. A search box that guesses turns a
 * typo into a jump to the wrong month, and the entity results below are a
 * better answer for anything ambiguous than a confident wrong date.
 */
export function parseDate(
  input: string,
  timeZone: string,
  now: Instant = Date.now(),
): ParsedDate | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const today = new Date(now);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const [thisYear, thisMonth, thisDay] = [get('year'), get('month') - 1, get('day')];

  const day = 24 * 60 * 60 * 1000;
  const todayAt = middayOn(thisYear, thisMonth, thisDay, timeZone);

  if (text === 'today') return { at: todayAt, label: `Today, ${label(todayAt, timeZone)}` };
  if (text === 'tomorrow') {
    const at = todayAt + day;
    return { at, label: `Tomorrow, ${label(at, timeZone)}` };
  }
  if (text === 'yesterday') {
    const at = todayAt - day;
    return { at, label: `Yesterday, ${label(at, timeZone)}` };
  }

  // 2026-08-14
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const at = middayOn(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), timeZone);
    return { at, label: label(at, timeZone) };
  }

  // "next tuesday" / "tuesday"
  const weekday = /^(next\s+)?([a-z]+)$/.exec(text);
  if (weekday) {
    const index = weekdayIndex(weekday[2]!);
    if (index >= 0) {
      const current = weekdayInZone(todayAt, timeZone);
      let ahead = (index - current + 7) % 7;

      // Plain "tuesday" on a Tuesday means today. "next tuesday" on a Tuesday
      // means the one after, since nobody says "next" about today.
      if (ahead === 0 && weekday[1]) ahead = 7;

      const at = todayAt + ahead * day;
      return { at, label: label(at, timeZone) };
    }
  }

  // "aug 14", "14 aug", "august 14 2026"
  const words = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 3) {
    let month = -1;
    let dayOfMonth = NaN;
    let year = thisYear;

    for (const word of words) {
      const asMonth = monthIndex(word);
      if (asMonth >= 0 && month < 0) {
        month = asMonth;
        continue;
      }
      const asNumber = Number(word.replace(/(st|nd|rd|th)$/, ''));
      if (!Number.isNaN(asNumber)) {
        if (asNumber >= 1000) year = asNumber;
        else if (Number.isNaN(dayOfMonth)) dayOfMonth = asNumber;
      }
    }

    if (month >= 0 && dayOfMonth >= 1 && dayOfMonth <= 31) {
      const at = middayOn(year, month, dayOfMonth, timeZone);
      return { at, label: label(at, timeZone) };
    }
  }

  return null;
}
