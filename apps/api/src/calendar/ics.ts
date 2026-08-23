/**
 * Writing iCalendar, the format calendar clients subscribe in (RFC 5545).
 *
 * The parts that are easy to get subtly wrong live here on their own: a line
 * longer than 75 octets has to be folded, a comma inside a value has to be
 * escaped, and a timestamp has to say which clock it is on. A client that finds
 * any of those wrong tends to drop the event rather than complain, so the
 * failure shows up as a calendar missing a day and nothing in the log.
 */

/** Where lines are folded, in octets rather than characters. */
const FOLD_AT = 75;

/**
 * Escapes a value written as iCalendar TEXT.
 *
 * The backslash goes first: escaping it after the others would go on to escape
 * the backslashes they just introduced.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Breaks one content line into the 75-octet pieces the format allows, joined by
 * a newline and a space.
 *
 * Counted in octets, which is why this works on the encoded bytes: a Japanese
 * place name is three bytes per character, so a line of 40 characters is over
 * the limit and a parser counting characters would leave it long. The split
 * never lands inside a character — a continuation byte begins `10`, so backing
 * up over those reaches the start of the one being cut.
 */
export function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= FOLD_AT) return line;

  const pieces: string[] = [];
  let start = 0;
  // The first piece gets the whole allowance. Every one after it spends an
  // octet on the leading space that marks it as a continuation.
  let allowance = FOLD_AT;

  while (start < bytes.length) {
    let end = Math.min(start + allowance, bytes.length);
    while (end > start + 1 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;

    pieces.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    allowance = FOLD_AT - 1;
  }

  return pieces.join('\r\n ');
}

/** Parameters on a property, such as `DTSTART;VALUE=DATE:20260414`. */
export type Parameters = Record<string, string>;

export function property(name: string, value: string, parameters?: Parameters): string {
  const rendered = Object.entries(parameters ?? {})
    .map(([key, parameter]) => `;${key}=${parameter}`)
    .join('');

  return `${name}${rendered}:${value}`;
}

/** The same, for a value that is prose and has to be escaped. */
export function textProperty(name: string, value: string, parameters?: Parameters): string {
  return property(name, escapeText(value), parameters);
}

/**
 * A property whose value is shown as written, with no escaping.
 *
 * For the `X-` properties, which are not in the format and so have no declared
 * value type. A parser that does not recognise a name has no grounds to
 * unescape its value, and readers differ on whether they try: `Japan\, April`
 * came back from one with the backslash still in it, which is what a calendar
 * would then have put in somebody's list of calendars.
 *
 * Only the line breaks are dealt with, because those would end the property
 * rather than appear in it.
 */
export function verbatimProperty(name: string, value: string): string {
  return property(name, value.replace(/\r\n|\r|\n/g, ' '));
}

/**
 * Joins content lines into a document.
 *
 * CRLF throughout and a trailing one, both of which the format requires. Bare
 * newlines are the single most common reason a hand-built calendar is rejected.
 */
export function render(lines: string[]): string {
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/**
 * An instant as a UTC timestamp: `20260414T090000Z`.
 *
 * Every time in a trip is stored as an instant, and UTC is what an instant is
 * without having to say anything else. The alternative — a local time tagged
 * with `TZID=Asia/Tokyo` — means the same moment but obliges the document to
 * carry a VTIMEZONE spelling out that zone's daylight-saving rules, and a
 * client that does not find one is entitled to read the time as floating,
 * which is how an event ends up nine hours out.
 *
 * What the local clock said is in the description instead, where it can be read
 * whatever zone the person looking is in.
 */
export function timestamp(at: number): string {
  return new Date(at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Cached because building one resolves a locale and loads a zone's rules. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;

  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }

  return found;
}

/**
 * The calendar day an instant falls on where the event is, as `20260414`.
 *
 * The zone is the whole point. An event at 08:00 in Tokyo is still the previous
 * evening in UTC, so a day taken from the timestamp would put it on the wrong
 * date — and a date-valued event has no time to correct it with afterwards.
 */
export function localDate(at: number, timeZone: string): string {
  // en-CA writes the parts largest first and dash-separated, which is the order
  // the format wants them in.
  return formatter('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at)
    .replace(/-/g, '');
}

/**
 * The day after a `YYYYMMDD` date.
 *
 * An all-day event ends on the day after the one it covers: the end of a
 * date-valued range is not included, so a one-day event that ended on its own
 * date would cover no days at all.
 */
export function dayAfter(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));

  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * An instant as somebody standing there would read it: `Tue 14 Apr 2026 17:05`.
 *
 * For the description, which is where a local clock has to be said in words —
 * the timestamps are all UTC, so a client shows a Tokyo morning in whatever
 * zone the reader's device is set to, and the time on the ticket is the one
 * they need at the airport.
 */
export function readableAt(at: number, timeZone: string): string {
  return formatter('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .replace(/,/g, '');
}

/** The same without a time, for a day that has no hour decided yet. */
export function readableDay(at: number, timeZone: string): string {
  return formatter('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
    .format(at)
    .replace(/,/g, '');
}
