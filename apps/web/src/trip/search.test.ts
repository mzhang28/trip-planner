import { addEvent, createTrip, updateEvent, type Doc, type TripDoc } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import { buildIndex, search } from './search';

const TOKYO = 'Asia/Tokyo';
const NOW = Date.UTC(2026, 7, 14, 3, 0);
const me = { userId: 'u1' };

function trip(): TripDoc {
  let doc: Doc = createTrip('Japan, April', TOKYO);

  doc = addEvent(doc, { id: 'e1', name: 'Fushimi Inari at dawn' }, me);
  doc = updateEvent(
    doc,
    'e1',
    { city: 'Kyoto', booking: { status: 'booked', confirmationCode: '7K2QLM' } },
    me,
  );

  doc = addEvent(doc, { id: 'e2', name: 'Nishiki Market lunch' }, me);
  doc = updateEvent(doc, 'e2', { city: 'Kyoto' }, me);

  doc = addEvent(doc, { id: 'e3', name: 'Dotonbori at night' }, me);
  doc = updateEvent(doc, 'e3', { city: 'Osaka' }, me);

  return doc as TripDoc;
}

function run(query: string) {
  const doc = trip();
  return search(query, buildIndex(doc), { homeTimezone: TOKYO, now: NOW });
}

describe('search', () => {
  it('finds an event by its name', () => {
    const hits = run('fushimi');
    expect(hits[0]).toMatchObject({ kind: 'event', label: 'Fushimi Inari at dawn' });
  });

  it('finds events by a city they are in', () => {
    const names = run('kyoto')
      .filter((hit) => hit.kind === 'event')
      .map((hit) => hit.label)
      .sort();

    expect(names).toEqual(['Fushimi Inari at dawn', 'Nishiki Market lunch']);
  });

  it('finds an event by something only in its searchable text', () => {
    // A confirmation code is never on screen in the list, but it is what
    // someone holding a booking email will type.
    expect(run('7K2QLM')[0]).toMatchObject({ kind: 'event', label: 'Fushimi Inari at dawn' });
  });

  it('forgives a typo', () => {
    expect(run('dotonbri')[0]).toMatchObject({ kind: 'event', label: 'Dotonbori at night' });
  });

  it('matches on a prefix, so results arrive while still typing', () => {
    expect(run('nish')[0]).toMatchObject({ kind: 'event', label: 'Nishiki Market lunch' });
  });

  it('offers a day when the query reads as a date', () => {
    const hits = run('aug 20');
    expect(hits[0]?.kind).toBe('day');
    expect(hits[0]?.detail).toBe('Jump to this day');
  });

  it('offers a day and the matching events together when a query is both', () => {
    // "today" is a date, and it is also an action people expect to find here.
    const kinds = run('today').map((hit) => hit.kind);
    expect(kinds).toContain('day');
    expect(kinds).toContain('command');
  });

  it('offers actions by what they do rather than only by their name', () => {
    const hits = run('invite');
    expect(hits.some((hit) => hit.kind === 'command' && hit.label === 'Share this trip')).toBe(true);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(run('')).toEqual([]);
    expect(run('   ')).toEqual([]);
  });

  it('leaves out events that have been deleted', () => {
    const doc = trip();
    const withoutDotonbori = search('dotonbori', buildIndex(doc), { homeTimezone: TOKYO });
    expect(withoutDotonbori).toHaveLength(1);

    // Tombstoned events are filtered by liveEvents before the index is built.
    const deleted = { ...doc, events: { ...doc.events, e3: { ...doc.events.e3!, deletedAt: 1 } } };
    expect(search('dotonbori', buildIndex(deleted), { homeTimezone: TOKYO })).toHaveLength(0);
  });

  it('copes with a replica that has not synced yet', () => {
    expect(search('anything', buildIndex(undefined), { homeTimezone: TOKYO })).toEqual([]);
  });
});
