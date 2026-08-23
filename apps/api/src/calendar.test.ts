import { resolve } from 'node:path';
import * as A from '@automerge/automerge';
import {
  addEvent,
  addFieldDef,
  addLink,
  addTodo,
  deleteEvent,
  setCustomField,
  updateEvent,
  type Doc,
  type TripDoc,
} from '@trip/crdt';
import { calendarFeeds } from '@trip/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { FsBlobStore } from './blobs/FsBlobStore';
import { tripCalendar } from './calendar/feed';
import { escapeText, fold } from './calendar/ics';
import { createDb, runMigrations, type Db } from './db';
import { DocStore } from './docStore';

const author = { userId: 'u1', now: 1_700_000_000_000 };

/** 14 April 2026, 09:00 in Tokyo. */
const TOKYO_MORNING = Date.parse('2026-04-14T00:00:00Z');

function trip(): Doc {
  return A.from<TripDoc>({
    meta: { name: 'Japan, April', homeTimezone: 'Asia/Tokyo' },
    files: {},
    fieldDefs: {},
    events: {},
  });
}

function ics(doc: Doc, confirmedOnly = false): string {
  return tripCalendar('t_japan', doc as TripDoc, { name: 'Japan, April', confirmedOnly });
}

/**
 * Puts a folded document back together.
 *
 * Anything long enough to be worth checking has been split across lines by the
 * time it is written, so a test looking for it has to undo that first — which
 * is also what every client does before reading a value.
 */
function unfold(calendar: string): string {
  return calendar.replace(/\r\n[ \t]/g, '');
}

/** The properties of a calendar, by name. */
function properties(calendar: string): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const line of unfold(calendar).split('\r\n')) {
    const at = line.indexOf(':');
    if (at === -1) continue;

    const name = line.slice(0, at);
    const value = line.slice(at + 1);
    found.set(name, [...(found.get(name) ?? []), value]);
  }

  return found;
}

describe('writing iCalendar', () => {
  it('folds a long line at 75 octets, and rejoins to what went in', () => {
    const line = `DESCRIPTION:${'a'.repeat(300)}`;
    const folded = fold(line);

    for (const piece of folded.split('\r\n ')) {
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(75);
    }

    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('never splits a character in half', () => {
    // Three octets each, so a naive cut at 75 octets lands mid-character.
    const line = `SUMMARY:${'伏見稲荷大社'.repeat(20)}`;

    const rejoined = fold(line).replace(/\r\n /g, '');

    expect(rejoined).toBe(line);
    // A split inside a character survives a round trip as a replacement mark,
    // which is what this is really checking for.
    expect(rejoined).not.toContain('�');
  });

  it('escapes what would otherwise end a value or start a parameter', () => {
    expect(escapeText('Shibuya, Tokyo; gate 3')).toBe('Shibuya\\, Tokyo\\; gate 3');
    expect(escapeText('one\ntwo')).toBe('one\\ntwo');
    expect(escapeText('back\\slash')).toBe('back\\\\slash');
  });
});

describe('which events reach a calendar', () => {
  it('leaves out an event that has no time yet', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'dated', name: 'Fushimi Inari' }, author);
    doc = updateEvent(doc, 'dated', { startsAt: TOKYO_MORNING }, author);
    doc = addEvent(doc, { id: 'someday', name: 'A pottery town, maybe' }, author);

    const calendar = ics(doc);

    expect(calendar).toContain('SUMMARY:Fushimi Inari');
    expect(calendar).not.toContain('pottery');
  });

  it('leaves out a deleted event', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'gone', name: 'Cancelled tour' }, author);
    doc = updateEvent(doc, 'gone', { startsAt: TOKYO_MORNING }, author);
    // Tombstoned rather than removed, so a peer that was offline learns about
    // the delete. A calendar has no reason to carry the tombstone.
    doc = deleteEvent(doc, 'gone', author);

    expect(ics(doc)).not.toContain('Cancelled tour');
  });

  it('leaves out the ideas when the feed was made for confirmed plans only', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'booked', name: 'Ryokan' }, author);
    doc = updateEvent(
      doc,
      'booked',
      { startsAt: TOKYO_MORNING, booking: { status: 'booked' } },
      author,
    );
    doc = addEvent(doc, { id: 'idea', name: 'Maybe the fish market' }, author);
    doc = updateEvent(doc, 'idea', { startsAt: TOKYO_MORNING }, author);

    const strict = ics(doc, true);

    expect(strict).toContain('SUMMARY:Ryokan');
    expect(strict).not.toContain('fish market');
    // The same trip with the other kind of feed keeps both.
    expect(ics(doc, false)).toContain('fish market');
  });

  it('puts the events in order, so an unchanged trip renders identically', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'later', name: 'Dinner' }, author);
    doc = updateEvent(doc, 'later', { startsAt: TOKYO_MORNING + 36_000_000 }, author);
    doc = addEvent(doc, { id: 'earlier', name: 'Breakfast' }, author);
    doc = updateEvent(doc, 'earlier', { startsAt: TOKYO_MORNING }, author);

    const calendar = ics(doc);

    expect(calendar.indexOf('Breakfast')).toBeLessThan(calendar.indexOf('Dinner'));
    expect(ics(doc)).toBe(calendar);
  });
});

describe('when an event happens', () => {
  it('writes the stored instant as UTC, whatever zone the event is in', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Tsukiji' }, author);
    doc = updateEvent(
      doc,
      'e1',
      {
        // 08:00 in Tokyo on 14 April, which is the 13th in UTC.
        startsAt: Date.parse('2026-04-13T23:00:00Z'),
        timezone: 'Asia/Tokyo',
        durationMinutes: 90,
      },
      author,
    );

    const found = properties(ics(doc));

    expect(found.get('DTSTART')).toEqual(['20260413T230000Z']);
    expect(found.get('DTEND')).toEqual(['20260414T003000Z']);
  });

  it('writes a day with no hour decided as a whole day where the event is', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Kyoto, wandering' }, author);
    doc = updateEvent(
      doc,
      'e1',
      {
        // Midnight in Tokyo, which is still the 13th in UTC. A calendar that
        // took the date off the timestamp would show this on the wrong day.
        startsAt: Date.parse('2026-04-13T15:00:00Z'),
        timezone: 'Asia/Tokyo',
        timeUndecided: true,
      },
      author,
    );

    const found = properties(ics(doc));

    expect(found.get('DTSTART;VALUE=DATE')).toEqual(['20260414']);
    // The end of a date range is not included, so a single day ends on the next.
    expect(found.get('DTEND;VALUE=DATE')).toEqual(['20260415']);
    expect(found.has('DTSTART')).toBe(false);
  });

  it('says the local clock in words, because the timestamps are all UTC', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Tea' }, author);
    doc = updateEvent(
      doc,
      'e1',
      { startsAt: Date.parse('2026-04-13T23:00:00Z'), timezone: 'Asia/Tokyo' },
      author,
    );

    expect(unfold(ics(doc))).toContain('Local time Tue 14 Apr 2026 08:00 (Asia/Tokyo)');
  });

  it('gives an event with no length no end at all', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Dinner somewhere' }, author);
    doc = updateEvent(doc, 'e1', { startsAt: TOKYO_MORNING }, author);

    const found = properties(ics(doc));

    expect(found.has('DTSTART')).toBe(true);
    expect(found.has('DTEND')).toBe(false);
  });

  it('ends a stay at its check-out', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Ryokan', kind: 'lodging' }, author);
    doc = updateEvent(
      doc,
      'e1',
      {
        startsAt: Date.parse('2026-04-14T06:00:00Z'),
        lodging: {
          checkIn: Date.parse('2026-04-14T06:00:00Z'),
          checkOut: Date.parse('2026-04-17T02:00:00Z'),
        },
      },
      author,
    );

    const found = properties(ics(doc));

    expect(found.get('DTEND')).toEqual(['20260417T020000Z']);

    const described = unfold(ics(doc));
    expect(described).toContain('Check in Tue 14 Apr 2026 15:00');
    expect(described).toContain('Check out Fri 17 Apr 2026 11:00');
    // The check-in already says when it starts, in better words than a second
    // line repeating the same clock.
    expect(described).not.toContain('Local time');
  });
});

describe('what an event carries into a calendar', () => {
  it('maps a confirmed booking to a busy, confirmed event and an idea to neither', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Ryokan' }, author);
    doc = updateEvent(
      doc,
      'e1',
      { startsAt: TOKYO_MORNING, booking: { status: 'booked' } },
      author,
    );

    let confirmed = properties(ics(doc));
    expect(confirmed.get('STATUS')).toEqual(['CONFIRMED']);
    expect(confirmed.get('TRANSP')).toEqual(['OPAQUE']);

    doc = updateEvent(doc, 'e1', { booking: { status: 'idea' } }, author);

    confirmed = properties(ics(doc));
    expect(confirmed.get('STATUS')).toEqual(['TENTATIVE']);
    // An idea should not black the day out for whoever subscribed.
    expect(confirmed.get('TRANSP')).toEqual(['TRANSPARENT']);
  });

  it('writes the place as a client would hand it to a map, commas escaped', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Fushimi Inari' }, author);
    doc = updateEvent(
      doc,
      'e1',
      {
        startsAt: TOKYO_MORNING,
        location: {
          label: 'Fushimi Inari Taisha',
          address: '68 Fukakusa Yabunouchicho, Kyoto',
          lat: 34.9671,
          lng: 135.7727,
        },
      },
      author,
    );

    const calendar = unfold(ics(doc));

    expect(calendar).toContain(
      'LOCATION:Fushimi Inari Taisha\\, 68 Fukakusa Yabunouchicho\\, Kyoto',
    );
    expect(calendar).toContain('GEO:34.9671;135.7727');
  });

  it('spells out a flight, both clocks and everything printed on the ticket', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Flight home', kind: 'transit' }, author);
    doc = updateEvent(
      doc,
      'e1',
      {
        startsAt: Date.parse('2026-04-20T08:05:00Z'),
        durationMinutes: 585,
        timezone: 'Asia/Tokyo',
        booking: { status: 'booked', confirmationCode: 'XR7T2Q' },
        transit: {
          method: 'flight',
          operator: 'ANA',
          number: 'NH 106',
          from: 'HND',
          to: 'SFO',
          fromCity: 'Tokyo',
          toCity: 'San Francisco',
          departsTz: 'Asia/Tokyo',
          arrivesTz: 'America/Los_Angeles',
          seat: '34K',
          terminal: '3',
          gate: '108',
        },
      },
      author,
    );

    const calendar = unfold(ics(doc));

    expect(calendar).toContain('Departs Mon 20 Apr 2026 17:05 (Asia/Tokyo)');
    // Same flight, and it lands in the morning of the same day it left.
    expect(calendar).toContain('Arrives Mon 20 Apr 2026 10:50 (America/Los_Angeles)');
    expect(calendar).toContain('Flight ANA NH 106: Tokyo (HND) → San Francisco (SFO)');
    expect(calendar).toContain('Seat 34K · Terminal 3 · Gate 108');
    expect(calendar).toContain('Confirmation: XR7T2Q');
  });

  it('carries the to-dos, the links, and the custom fields nothing else has room for', () => {
    let doc = trip();
    doc = addFieldDef(doc, {
      id: 'f_cost',
      label: 'Cost per person',
      type: 'money',
      currency: 'JPY',
      order: 0,
    });

    doc = addEvent(doc, { id: 'e1', name: 'Tea ceremony' }, author);
    doc = updateEvent(
      doc,
      'e1',
      { startsAt: TOKYO_MORNING, description: 'Wear something you can kneel in.' },
      author,
    );
    doc = setCustomField(doc, 'e1', 'f_cost', { kind: 'number', number: 4500 }, author);
    doc = addTodo(doc, 'e1', 'td_1', { text: 'Print the voucher', deadline: '2026-04-10' }, author);
    doc = addLink(doc, 'e1', 'l_1', { url: 'https://example.test/tea', title: 'Booking' }, author);

    const calendar = unfold(ics(doc));

    expect(calendar).toContain('Wear something you can kneel in.');
    expect(calendar).toContain('Cost per person (JPY): 4500');
    expect(calendar).toContain('[ ] Print the voucher (by 2026-04-10)');
    expect(calendar).toContain('Booking: https://example.test/tea');
    // The first link is also somewhere a client can turn into a button.
    expect(properties(ics(doc)).get('URL')).toEqual(['https://example.test/tea']);
  });

  it('names the calendar and the zone it is planned in', () => {
    const found = properties(ics(trip()));

    /*
     * Written as it reads, with no escaping. These properties are not in the
     * format, so a parser has no declared type to unescape them by -- one
     * handed back `Japan\, April` with the backslash still in it, and that is
     * the string a calendar would then have shown in somebody's list.
     */
    expect(found.get('X-WR-CALNAME')).toEqual(['Japan, April']);
    expect(found.get('X-WR-TIMEZONE')).toEqual(['Asia/Tokyo']);
    // How often a client is asked to come back, which is the whole point of a
    // subscription rather than a download.
    expect(found.get('REFRESH-INTERVAL;VALUE=DURATION')).toEqual(['PT1H']);
  });

  it('keeps an event under the same name across an edit', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e1', name: 'Tea' }, author);
    doc = updateEvent(doc, 'e1', { startsAt: TOKYO_MORNING }, author);

    const before = properties(ics(doc)).get('UID');

    doc = updateEvent(
      doc,
      'e1',
      { name: 'Tea ceremony', startsAt: TOKYO_MORNING + 3600_000 },
      {
        userId: 'u1',
        now: author.now + 1000,
      },
    );

    // A subscriber has to see this as the event moving. A new UID reads as the
    // old one being deleted and an unrelated one appearing.
    expect(properties(ics(doc)).get('UID')).toEqual(before);
  });
});

describe('subscribing over HTTP', () => {
  let db: Db;
  let docs: DocStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    docs = new DocStore(db);
    app = createApp({ db, docs, blobs: new FsBlobStore('/tmp/trip-calendar-unused') });
  });

  /** Creates a trip, and keeps the cookie the server minted a person into. */
  async function newTrip() {
    const response = await app.request('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });

    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const { id } = (await response.json()) as { id: string };

    return { id, cookie };
  }

  async function subscribe(tripId: string, cookie: string, body: unknown = {}) {
    const response = await app.request(`/api/trips/${tripId}/calendar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; url: string; webcalUrl: string };
  }

  function edit(tripId: string, mutate: (doc: Doc) => Doc) {
    const before = docs.load(tripId)!;
    const after = mutate(before);
    docs.commit(tripId, after, A.getChanges(before, after), 'u1');
  }

  /** The path a client would poll, taken off the absolute URL it was given. */
  function feedPath(url: string): string {
    return new URL(url).pathname;
  }

  it('answers a poll with the trip as calendar text, and no session anywhere', async () => {
    const { id, cookie } = await newTrip();
    edit(id, (doc) => {
      const withEvent = addEvent(doc, { id: 'e1', name: 'Fushimi Inari' }, author);
      return updateEvent(withEvent, 'e1', { startsAt: TOKYO_MORNING }, author);
    });

    const feed = await subscribe(id, cookie);
    const response = await app.request(feedPath(feed.url));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');

    const body = await response.text();
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body).toContain('SUMMARY:Fushimi Inari');
    // Nothing was created for whoever asked, which a subscription polling
    // hourly forever would otherwise do.
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('offers the same URL in the scheme that makes a client subscribe', async () => {
    const { id, cookie } = await newTrip();
    const feed = await subscribe(id, cookie);

    expect(feed.url).toMatch(/\/calendar\/[\w-]+\.ics$/);
    expect(feed.webcalUrl).toBe(feed.url.replace(/^https?:/, 'webcal:'));
  });

  it('shows an edit made after the subscription, without being asked again', async () => {
    const { id, cookie } = await newTrip();
    const feed = await subscribe(id, cookie);

    const before = await (await app.request(feedPath(feed.url))).text();
    expect(before).not.toContain('Nishiki Market');

    edit(id, (doc) => {
      const withEvent = addEvent(doc, { id: 'e2', name: 'Nishiki Market' }, author);
      return updateEvent(withEvent, 'e2', { startsAt: TOKYO_MORNING }, author);
    });

    expect(await (await app.request(feedPath(feed.url))).text()).toContain('Nishiki Market');
  });

  it('answers an unchanged trip with nothing to download', async () => {
    const { id, cookie } = await newTrip();
    edit(id, (doc) => {
      const withEvent = addEvent(doc, { id: 'e1', name: 'Fushimi Inari' }, author);
      return updateEvent(withEvent, 'e1', { startsAt: TOKYO_MORNING }, author);
    });

    const feed = await subscribe(id, cookie);
    const first = await app.request(feedPath(feed.url));
    const etag = first.headers.get('etag')!;

    expect(etag).toBeTruthy();

    const again = await app.request(feedPath(feed.url), {
      headers: { 'if-none-match': etag },
    });

    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');

    // An edit a calendar can see has to break it, or a subscriber never
    // refetches.
    edit(id, (doc) => updateEvent(doc, 'e1', { name: 'Fushimi Inari at dawn' }, author));

    const third = await app.request(feedPath(feed.url), { headers: { 'if-none-match': etag } });
    expect(third.status).toBe(200);
  });

  it('works without the .ics on the end, which is only there for the clients', async () => {
    const { id, cookie } = await newTrip();
    const feed = await subscribe(id, cookie);

    const bare = await app.request(feedPath(feed.url).replace(/\.ics$/, ''));

    expect(bare.status).toBe(200);
  });

  it('records that something is polling, which is the only sign it worked', async () => {
    const { id, cookie } = await newTrip();
    const feed = await subscribe(id, cookie);

    const unused = db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)).get();
    expect(unused?.fetchCount).toBe(0);
    expect(unused?.lastFetchedAt).toBeNull();

    await app.request(feedPath(feed.url));
    await app.request(feedPath(feed.url));

    const polled = db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feed.id)).get();
    expect(polled?.fetchCount).toBe(2);
    expect(polled?.lastFetchedAt).toBeGreaterThan(0);
  });

  it('stops answering once the feed is revoked, and says nothing about the trip', async () => {
    const { id, cookie } = await newTrip();
    const feed = await subscribe(id, cookie);

    expect((await app.request(feedPath(feed.url))).status).toBe(200);

    const revoked = await app.request(`/api/trips/${id}/calendar/${feed.id}/revoke`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(revoked.status).toBe(200);

    const after = await app.request(feedPath(feed.url));
    expect(after.status).toBe(404);

    // A token nobody ever issued is refused the same way, so guessing at URLs
    // reveals nothing.
    const invented = await app.request('/calendar/not-a-real-token.ics');
    expect(invented.status).toBe(404);
    expect(await invented.text()).toBe(await after.text());
  });

  it('lists the feeds without the tokens, since only their hashes were kept', async () => {
    const { id, cookie } = await newTrip();
    await subscribe(id, cookie, { label: 'My phone' });
    const second = await subscribe(id, cookie, { label: 'Everything booked', confirmedOnly: true });

    const listed = await app.request(`/api/trips/${id}/calendar`, { headers: { cookie } });
    const { feeds } = (await listed.json()) as {
      feeds: { id: string; label: string; confirmedOnly: boolean; createdByName: string }[];
    };

    expect(feeds.map((feed) => feed.label)).toEqual(['Everything booked', 'My phone']);
    expect(feeds.find((feed) => feed.id === second.id)?.confirmedOnly).toBe(true);
    expect(feeds[0]?.createdByName).toBeTruthy();

    const asText = JSON.stringify(feeds);
    expect(asText).not.toContain(new URL(second.url).pathname.split('/').pop()!.slice(0, 20));
  });

  it('refuses to make a feed for a trip the caller is not on', async () => {
    const { id, cookie: owner } = await newTrip();

    // The first person to arrive shuts the door behind them, so a second
    // browser has to be let in before it can be turned away for the right
    // reason.
    await app.request('/api/instance', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ registrationOpen: true }),
    });

    const stranger = await app.request('/api/me');
    const cookie = stranger.headers.get('set-cookie')!.split(';')[0]!;

    const attempt = await app.request(`/api/trips/${id}/calendar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });

    expect(attempt.status).toBe(403);
  });
});
