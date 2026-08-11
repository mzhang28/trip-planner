import * as A from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import {
  addEvent,
  addLink,
  createTrip,
  deleteEvent,
  liveEvents,
  setCustomField,
  updateEvent,
  type Doc,
} from './doc';
import { canSyncIncrementally, sweepTombstones, TOMBSTONE_TTL_MS } from './sweep';
import type { TripDoc } from './types';

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
});
