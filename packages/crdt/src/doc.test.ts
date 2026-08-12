import * as A from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import {
  addEvent,
  addFieldDef,
  addFieldOption,
  addLink,
  createTrip,
  deleteEvent,
  deleteEvents,
  liveEvents,
  mergeEvents,
  setCityColor,
  setCustomField,
  updateEvent,
  updateFieldOption,
  updateTripMeta,
  type Doc,
} from './doc';
import { canSyncIncrementally, sweepTombstones, TOMBSTONE_TTL_MS } from './sweep';
import type { EventId, TripDoc } from './types';

const ada = { userId: 'user-ada' };
const bo = { userId: 'user-bo' };

/**
 * Two replicas of the same trip, as two people's browsers would hold it.
 *
 * They are forked from one document rather than built separately, so they share
 * history up to the fork the way two devices that synced this morning do.
 */
function fork(doc: Doc): [Doc, Doc] {
  return [A.clone(doc), A.clone(doc)];
}

function bothWays(a: Doc, b: Doc): [Doc, Doc] {
  return [A.merge(A.clone(a), b), A.merge(A.clone(b), a)];
}

function trip(): Doc {
  let doc = createTrip('Japan, April', 'Asia/Tokyo');
  doc = addEvent(doc, { id: 'e1', name: 'Fushimi Inari' }, ada);
  return doc;
}

describe('trip dates', () => {
  it('sets and clears the trip-wide bounds', () => {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    doc = updateTripMeta(doc, { startsAt: 1_776_000_000_000, endsAt: 1_777_000_000_000 });

    expect((doc as TripDoc).meta.startsAt).toBe(1_776_000_000_000);
    expect((doc as TripDoc).meta.endsAt).toBe(1_777_000_000_000);

    doc = updateTripMeta(doc, { endsAt: undefined });
    expect((doc as TripDoc).meta.endsAt).toBeUndefined();
  });
});

describe('choice colors', () => {
  it('sets and clears a color without replacing the choice label', () => {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    doc = addFieldDef(doc, {
      id: 'mood',
      label: 'Mood',
      type: 'select',
      order: 0,
    });
    doc = addFieldOption(doc, 'mood', 'quiet', { label: 'Quiet' });

    doc = updateFieldOption(doc, 'mood', 'quiet', { color: '#1E3A8A' });
    expect((doc as TripDoc).fieldDefs.mood?.options?.quiet).toEqual({
      label: 'Quiet',
      color: '#1E3A8A',
    });

    doc = updateFieldOption(doc, 'mood', 'quiet', { color: undefined });
    expect((doc as TripDoc).fieldDefs.mood?.options?.quiet).toEqual({ label: 'Quiet' });
  });

  it('stores an event color separately from its shared city color', () => {
    let doc = trip();
    doc = updateEvent(doc, 'e1', { city: 'Kyoto', color: '#1E3A8A' }, ada);
    doc = setCityColor(doc, 'Kyoto', '#FACC15');

    expect((doc as TripDoc).events.e1?.color).toBe('#1E3A8A');
    expect((doc as TripDoc).cityColors?.Kyoto).toBe('#FACC15');

    doc = setCityColor(doc, 'Kyoto', undefined);
    expect((doc as TripDoc).cityColors?.Kyoto).toBeUndefined();
    expect((doc as TripDoc).events.e1?.color).toBe('#1E3A8A');
  });
});

describe('offline edits merging', () => {
  it('keeps both edits when two people change different fields', () => {
    const [left, right] = fork(trip());

    const withCity = updateEvent(left, 'e1', { city: 'Kyoto' }, ada);
    const withTime = updateEvent(right, 'e1', { startsAt: 1_776_000_000_000 }, bo);

    const [a, b] = bothWays(withCity, withTime);

    for (const doc of [a, b] as TripDoc[]) {
      expect(doc.events.e1?.city).toBe('Kyoto');
      expect(doc.events.e1?.startsAt).toBe(1_776_000_000_000);
    }
  });

  it('settles on one value when two people change the same field, and both agree which', () => {
    const [left, right] = fork(trip());

    const a = updateEvent(left, 'e1', { name: 'Fushimi Inari at dawn' }, ada);
    const b = updateEvent(right, 'e1', { name: 'Fushimi Inari shrine' }, bo);

    const [mergedA, mergedB] = bothWays(a, b);

    const nameA = (mergedA as TripDoc).events.e1?.name;
    const nameB = (mergedB as TripDoc).events.e1?.name;

    // Which one wins is arbitrary, but it has to be the same on both sides.
    // A replica that shows a different answer to its neighbour is the failure
    // that matters here, not which of the two names survived.
    expect(nameA).toBe(nameB);
    expect(['Fushimi Inari at dawn', 'Fushimi Inari shrine']).toContain(nameA);
  });

  it('keeps every link when two people each add one offline', () => {
    const [left, right] = fork(trip());

    const a = addLink(left, 'e1', 'l1', { url: 'https://inari.jp', title: 'Official' }, ada);
    const b = addLink(right, 'e1', 'l2', { url: 'https://maps.example/inari' }, bo);

    const [mergedA, mergedB] = bothWays(a, b);

    for (const doc of [mergedA, mergedB] as TripDoc[]) {
      expect(Object.keys(doc.events.e1?.links ?? {}).sort()).toEqual(['l1', 'l2']);
    }
  });

  it('keeps both ticks when two people select different options of one field', () => {
    let base = trip();
    base = setCustomField(base, 'e1', 'f1', { kind: 'options', selected: {} }, ada);

    const [left, right] = fork(base);

    const a = A.change(left, (d) => {
      const value = d.events.e1?.customFields.f1;
      if (value?.kind === 'options') value.selected['guided'] = true;
    });
    const b = A.change(right, (d) => {
      const value = d.events.e1?.customFields.f1;
      if (value?.kind === 'options') value.selected['early-entry'] = true;
    });

    const [mergedA, mergedB] = bothWays(a, b);

    for (const doc of [mergedA, mergedB] as TripDoc[]) {
      const value = doc.events.e1?.customFields.f1;
      expect(value?.kind).toBe('options');
      if (value?.kind === 'options') {
        expect(Object.keys(value.selected).sort()).toEqual(['early-entry', 'guided']);
      }
    }
  });

  it('does not revive an event when the peer that deleted it merges with one that edited it', () => {
    const [left, right] = fork(trip());

    const deleted = deleteEvent(left, 'e1', ada);
    const edited = updateEvent(right, 'e1', { city: 'Kyoto' }, bo);

    const [a, b] = bothWays(deleted, edited);

    for (const doc of [a, b] as TripDoc[]) {
      expect(doc.events.e1?.deletedAt).toBeTypeOf('number');
      expect(liveEvents(doc)).toHaveLength(0);
    }
  });
});

describe('a replica that has not synced yet', () => {
  it('reads as an empty trip rather than throwing', () => {
    // What the browser holds between opening a trip and hearing back from the
    // server: a real Automerge document with none of the keys in it.
    const empty = A.init<TripDoc>() as TripDoc;

    expect(liveEvents(empty)).toEqual([]);
    expect(liveEvents(undefined)).toEqual([]);
  });
});

describe('tombstone sweep', () => {
  const now = 1_800_000_000_000;

  it('removes a tombstone past the horizon and leaves a fresh one alone', () => {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'old', name: 'Cancelled tour' }, ada);
    doc = addEvent(doc, { id: 'recent', name: 'Changed my mind' }, ada);
    doc = addEvent(doc, { id: 'live', name: 'Still going' }, ada);

    doc = deleteEvent(doc, 'old', { ...ada, now: now - TOMBSTONE_TTL_MS - 1 });
    doc = deleteEvent(doc, 'recent', { ...ada, now: now - 1000 });

    const result = sweepTombstones(doc, now);
    const swept = result.doc as TripDoc;

    expect(result.removedEvents).toEqual(['old']);
    expect(swept.events.old).toBeUndefined();
    expect(swept.events.recent?.deletedAt).toBeTypeOf('number');
    expect(swept.events.live).toBeDefined();
  });

  it('drops values belonging to a swept field definition', () => {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'e1', name: 'Ryokan' }, ada);
    doc = A.change(doc, (d) => {
      d.fieldDefs.f1 = {
        id: 'f1',
        label: 'Dress code',
        type: 'text',
        order: 0,
        deletedAt: now - TOMBSTONE_TTL_MS - 1,
      };
    });
    doc = setCustomField(doc, 'e1', 'f1', { kind: 'text', text: 'yukata' }, ada);

    const result = sweepTombstones(doc, now);
    const swept = result.doc as TripDoc;

    expect(result.removedFieldDefs).toEqual(['f1']);
    expect(swept.fieldDefs.f1).toBeUndefined();
    expect(swept.events.e1?.customFields.f1).toBeUndefined();
  });

  it('is a no-op that returns the same document when nothing has expired', () => {
    const doc = trip();
    const result = sweepTombstones(doc, now);

    expect(result.removedEvents).toEqual([]);
    expect(result.doc).toBe(doc);
  });
});

describe('who may sync incrementally', () => {
  const sweptAt = 1_800_000_000_000;

  it('allows anyone when no sweep has ever run', () => {
    expect(canSyncIncrementally(undefined, undefined)).toBe(true);
    expect(canSyncIncrementally(1, undefined)).toBe(true);
  });

  it('allows a peer that synced after the sweep', () => {
    expect(canSyncIncrementally(sweptAt, sweptAt)).toBe(true);
    expect(canSyncIncrementally(sweptAt + 1, sweptAt)).toBe(true);
  });

  it('refuses a peer that has not synced since before the sweep', () => {
    expect(canSyncIncrementally(sweptAt - 1, sweptAt)).toBe(false);
  });

  it('refuses a peer that has never synced once a sweep has run', () => {
    // It holds a document from somewhere, but nothing says it saw the
    // tombstones, so it has to take a fresh copy.
    expect(canSyncIncrementally(undefined, sweptAt)).toBe(false);
  });

  it('allows a peer carrying nothing, whatever its history says', () => {
    /*
     * This is the state a peer is in the moment after being told to start
     * again: no document, no last sync. Refusing it there leaves it asking and
     * being refused for ever, and an empty document cannot revive anything.
     */
    expect(canSyncIncrementally(undefined, sweptAt, false)).toBe(true);
    expect(canSyncIncrementally(sweptAt - 10_000, sweptAt, false)).toBe(true);
  });

  it('still refuses a peer that is carrying something from before the sweep', () => {
    expect(canSyncIncrementally(sweptAt - 1, sweptAt, true)).toBe(false);
  });
});

describe('merging events', () => {
  const now = 1_800_000_000_000;
  const hour = 60 * 60 * 1000;

  function pair(): Doc {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'a', name: 'Market, morning' }, ada);
    doc = addEvent(doc, { id: 'b', name: 'Market, afternoon' }, ada);
    return doc;
  }

  it('keeps the earliest start and a span covering everything folded in', () => {
    let doc = pair();
    doc = updateEvent(doc, 'a', { startsAt: now, durationMinutes: 60 }, ada);
    doc = updateEvent(doc, 'b', { startsAt: now + 3 * hour, durationMinutes: 60 }, ada);

    doc = mergeEvents(doc, 'a', ['b'], { ...ada, now });
    const merged = (doc as TripDoc).events.a!;

    expect(merged.startsAt).toBe(now);
    // Four hours from the first start to the second finish. Keeping the
    // primary's own hour would shorten an afternoon that was two halves.
    expect(merged.durationMinutes).toBe(240);
  });

  it('takes the most settled status', () => {
    let doc = pair();
    doc = updateEvent(doc, 'a', { booking: { status: 'idea' } }, ada);
    doc = updateEvent(doc, 'b', { booking: { status: 'booked' } }, ada);

    doc = mergeEvents(doc, 'a', ['b'], { ...ada, now });

    // A booked half and an idea half together are a booking.
    expect((doc as TripDoc).events.a!.booking.status).toBe('booked');
  });

  it('keeps the primary name and fills its gaps from the others', () => {
    let doc = pair();
    doc = updateEvent(doc, 'b', { city: 'Kyoto', location: { label: 'Nishiki' } }, ada);

    doc = mergeEvents(doc, 'a', ['b'], { ...ada, now });
    const merged = (doc as TripDoc).events.a!;

    expect(merged.name).toBe('Market, morning');
    expect(merged.city).toBe('Kyoto');
    expect(merged.location?.label).toBe('Nishiki');
  });

  it('gathers every link rather than keeping one side', () => {
    let doc = pair();
    doc = addLink(doc, 'a', 'l1', { url: 'https://one.example' }, ada);
    doc = addLink(doc, 'b', 'l2', { url: 'https://two.example' }, ada);

    doc = mergeEvents(doc, 'a', ['b'], { ...ada, now });

    expect(Object.keys((doc as TripDoc).events.a!.links).sort()).toEqual(['l1', 'l2']);
  });

  it('joins the descriptions rather than dropping one', () => {
    let doc = pair();
    doc = updateEvent(doc, 'a', { description: 'Go early' }, ada);
    doc = updateEvent(doc, 'b', { description: 'Bring cash' }, ada);

    doc = mergeEvents(doc, 'a', ['b'], { ...ada, now });
    const description = (doc as TripDoc).events.a!.description!;

    expect(description).toContain('Go early');
    expect(description).toContain('Bring cash');
  });

  it('tombstones what it folded in rather than removing it', () => {
    let doc = mergeEvents(pair(), 'a', ['b'], { ...ada, now });

    // A peer that was offline has to learn these went away, not merge them back.
    expect((doc as TripDoc).events.b!.deletedAt).toBe(now);
    expect(liveEvents(doc as TripDoc).map((event) => event.id)).toEqual(['a']);
  });

  it('does nothing when there is nothing to merge into it', () => {
    const doc = pair();
    const merged = mergeEvents(doc, 'a', ['a'], { ...ada, now });

    expect(liveEvents(merged as TripDoc)).toHaveLength(2);
  });
});

describe('deleting several at once', () => {
  it('tombstones them all in one change, so undoing it is one step', () => {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    for (const id of ['a', 'b', 'c']) {
      doc = addEvent(doc, { id, name: id }, ada);
    }

    const before = A.getAllChanges(doc).length;
    doc = deleteEvents(doc, ['a', 'b'], { ...ada, now: 1 });

    expect(A.getAllChanges(doc).length).toBe(before + 1);
    expect(liveEvents(doc as TripDoc).map((event) => event.id)).toEqual(['c']);
  });

  it('skips what is already gone rather than restamping it', () => {
    let doc = createTrip('Japan, April', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'a', name: 'a' }, ada);
    doc = deleteEvent(doc, 'a', { ...ada, now: 1 });
    doc = deleteEvents(doc, ['a'], { ...ada, now: 999 });

    expect((doc as TripDoc).events.a!.deletedAt).toBe(1);
  });
});

describe('a patch carrying an object', () => {
  it('takes a place whose street address is unknown', () => {
    let doc = createTrip('Japan', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'e1' as EventId, name: 'Fushimi Inari' }, { userId: 'u1' });

    /*
     * Spreading what is already there is how every patch here is built, so a
     * key with nothing in it is normal. Automerge rejects undefined outright,
     * and one such key used to throw away the whole change -- a place chosen
     * from the map arrived with no address and so never arrived at all.
     */
    doc = updateEvent(
      doc,
      'e1' as EventId,
      { location: { label: 'Kyoto Station', address: undefined, lat: 34.98, lng: 135.75 } },
      { userId: 'u1' },
    );

    expect(doc.events.e1!.location).toEqual({ label: 'Kyoto Station', lat: 34.98, lng: 135.75 });
  });
});
