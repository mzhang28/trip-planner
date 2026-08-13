import * as A from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import {
  addAttachment,
  addEvent,
  addFieldDef,
  addFieldOption,
  addLink,
  addTripFile,
  addTodo,
  clearField,
  createTrip,
  deleteEvent,
  deleteEvents,
  fieldContents,
  liveEvents,
  mergeEvents,
  normalizeBookingStatuses,
  normalizeEventKinds,
  referencedBlobs,
  removeTodo,
  restoreField,
  setCityColor,
  setCustomField,
  tripFiles,
  updateEvent,
  updateFieldOption,
  updateTripMeta,
  updateTodo,
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

describe('booking status', () => {
  it('turns the removed intermediate state into Flexible', () => {
    const legacy = A.change(trip(), (draft) => {
      (draft.events.e1!.booking as { status: string }).status = 'in_progress';
    });

    const normalized = normalizeBookingStatuses(legacy);

    expect((normalized as TripDoc).events.e1!.booking.status).toBe('idea');
  });
});

describe('folding flight into transit', () => {
  it('turns a flight event into a transit journey with method flight', () => {
    const legacy = A.change(trip(), (draft) => {
      const event = draft.events.e1! as unknown as Record<string, unknown>;
      event.kind = 'flight';
      event.flight = {
        airline: 'ANA',
        number: 'NH017',
        from: 'NRT',
        to: 'ITM',
        fromCity: 'Tokyo',
        toCity: 'Osaka',
        seat: '32A',
      };
    });

    const migrated = normalizeEventKinds(legacy) as TripDoc;
    const event = migrated.events.e1!;

    expect(event.kind).toBe('transit');
    // airline is the one field that changed name; the rest carry over.
    expect(event.transit).toEqual({
      method: 'flight',
      operator: 'ANA',
      number: 'NH017',
      from: 'NRT',
      to: 'ITM',
      fromCity: 'Tokyo',
      toCity: 'Osaka',
      seat: '32A',
    });
    expect((event as unknown as Record<string, unknown>).flight).toBeUndefined();
  });

  it('gives an older transit event a method in place of its mode', () => {
    const legacy = A.change(trip(), (draft) => {
      const event = draft.events.e1! as unknown as Record<string, unknown>;
      event.kind = 'transit';
      event.transit = { mode: 'transit', fromCity: 'Kyoto', toCity: 'Nara' };
    });

    const migrated = normalizeEventKinds(legacy) as TripDoc;

    // "Train / bus" was what that mode was labelled, so it becomes a train.
    expect(migrated.events.e1!.transit).toEqual({
      method: 'train',
      fromCity: 'Kyoto',
      toCity: 'Nara',
    });
  });

  it('writes nothing when every event is already in the new shape', () => {
    const already = A.change(trip(), (draft) => {
      const event = draft.events.e1! as unknown as Record<string, unknown>;
      event.kind = 'transit';
      event.transit = { method: 'ferry', fromCity: 'Naoshima', toCity: 'Uno' };
    });

    const migrated = normalizeEventKinds(already);

    // An empty Automerge change records nothing, so nothing syncs to peers.
    expect(A.getChanges(already, migrated)).toHaveLength(0);
  });
});

describe('trip file library', () => {
  const file = {
    blobHash: 'a'.repeat(64),
    filename: 'booking.pdf',
    mime: 'application/pdf',
    size: 42,
    addedAt: 123,
  };

  it('stores one reusable file while the same bytes are attached to several events', () => {
    let doc = trip();
    doc = addEvent(doc, { id: 'e2', name: 'Hotel' }, ada);
    doc = addAttachment(doc, 'e1', 'a1', file, ada);
    doc = addAttachment(doc, 'e2', 'a2', file, ada);

    expect(tripFiles(doc as TripDoc)).toEqual([file]);
    expect(Object.keys((doc as TripDoc).files ?? {})).toEqual([file.blobHash]);
  });

  it('attaches a file read from the Automerge library without reusing its document object', () => {
    let doc = addTripFile(trip(), file);
    const libraryFile = (doc as TripDoc).files![file.blobHash]!;

    expect(() => {
      doc = addAttachment(doc, 'e1', 'a1', libraryFile, ada);
    }).not.toThrow();
    expect((doc as TripDoc).events.e1!.attachments.a1).toEqual(file);
  });

  it('keeps a standalone library upload reachable by blob collection', () => {
    const doc = addTripFile(createTrip('Japan', 'Asia/Tokyo'), file);

    expect(referencedBlobs(doc as TripDoc)).toEqual(new Set([file.blobHash]));
  });

  it('discovers attachments made before the library existed', () => {
    const doc = A.change(trip(), (draft) => {
      delete draft.files;
      draft.events.e1!.attachments.a1 = file;
    });

    expect(tripFiles(doc as TripDoc)).toEqual([file]);
  });
});

describe('event todos', () => {
  it('adds, completes, dates, and removes a todo without replacing the collection', () => {
    let doc = trip();
    doc = addTodo(doc, 'e1', 'todo-1', { text: 'Reserve the train' }, { ...ada, now: 10 });
    doc = updateTodo(
      doc,
      'e1',
      'todo-1',
      { completed: true, deadline: '2026-09-03' },
      ada,
    );

    expect((doc as TripDoc).events.e1!.todos?.['todo-1']).toEqual({
      text: 'Reserve the train',
      completed: true,
      deadline: '2026-09-03',
      addedAt: 10,
    });

    doc = removeTodo(doc, 'e1', 'todo-1', ada);
    expect((doc as TripDoc).events.e1!.todos).toEqual({});
  });

  it('keeps todos added by two people while they are offline', () => {
    const [left, right] = fork(trip());
    const a = addTodo(left, 'e1', 'todo-a', { text: 'Buy tickets' }, ada);
    const b = addTodo(right, 'e1', 'todo-b', { text: 'Check opening hours' }, bo);

    for (const doc of bothWays(a, b) as TripDoc[]) {
      expect(Object.values(doc.events.e1!.todos ?? {}).map((todo) => todo.text).sort()).toEqual([
        'Buy tickets',
        'Check opening hours',
      ]);
    }
  });
});

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

  it('takes the most fixed status', () => {
    let doc = pair();
    doc = updateEvent(doc, 'a', { booking: { status: 'idea' } }, ada);
    doc = updateEvent(doc, 'b', { booking: { status: 'booked' } }, ada);

    doc = mergeEvents(doc, 'a', ['b'], { ...ada, now });

    // A Confirmed half and a Flexible half together are Confirmed.
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

describe('taking a field off an event', () => {
  it('removes what the field holds and nothing beside it', () => {
    let doc = trip();
    doc = updateEvent(
      doc,
      'e1' as EventId,
      { booking: { status: 'booked', confirmationCode: '7K2QLM', note: 'paid in full' } },
      ada,
    );

    const held = fieldContents(doc.events.e1!, 'confirmation');
    doc = clearField(doc, 'e1' as EventId, 'confirmation', ada);

    expect(doc.events.e1!.booking.confirmationCode).toBeUndefined();
    // The status and the note share `booking` with the code and are their own
    // fields on the card, so neither goes with it.
    expect(doc.events.e1!.booking.status).toBe('booked');
    expect(doc.events.e1!.booking.note).toBe('paid in full');

    doc = restoreField(doc, 'e1' as EventId, held, ada);
    expect(doc.events.e1!.booking.confirmationCode).toBe('7K2QLM');
  });

  it('gives a collection back under the ids it had', () => {
    let doc = trip();
    doc = addLink(doc, 'e1' as EventId, 'l1', { url: 'https://example.com/a' }, ada);
    doc = addLink(doc, 'e1' as EventId, 'l2', { url: 'https://example.com/b', title: 'B' }, ada);

    const held = fieldContents(doc.events.e1!, 'links');
    doc = clearField(doc, 'e1' as EventId, 'links', ada);

    // Emptied, not removed: every reader of an event expects the map to be
    // there.
    expect(doc.events.e1!.links).toEqual({});

    doc = restoreField(doc, 'e1' as EventId, held, ada);
    expect(Object.keys(doc.events.e1!.links)).toEqual(['l1', 'l2']);
    expect(doc.events.e1!.links.l2!.title).toBe('B');
  });

  it('takes a date and the flag that goes with it together', () => {
    let doc = trip();
    doc = updateEvent(
      doc,
      'e1' as EventId,
      { startsAt: 1_772_000_000_000, timeUndecided: true, timezone: 'Asia/Tokyo' },
      ada,
    );

    const held = fieldContents(doc.events.e1!, 'when');
    doc = clearField(doc, 'e1' as EventId, 'when', ada);

    expect(doc.events.e1!.startsAt).toBeUndefined();
    expect(doc.events.e1!.timeUndecided).toBeUndefined();
    expect(doc.events.e1!.timezone).toBeUndefined();

    doc = restoreField(doc, 'e1' as EventId, held, ada);
    expect(doc.events.e1!.startsAt).toBe(1_772_000_000_000);
    expect(doc.events.e1!.timeUndecided).toBe(true);
  });

  it('removes a custom field from the event without touching its definition', () => {
    let doc = trip();
    doc = addFieldDef(doc, { id: 'f1', label: 'Cost', type: 'money', currency: 'JPY', order: 0 });
    doc = setCustomField(doc, 'e1' as EventId, 'f1', { kind: 'number', number: 1200 }, ada);

    const held = fieldContents(doc.events.e1!, 'custom:f1');
    doc = clearField(doc, 'e1' as EventId, 'custom:f1', ada);

    expect(doc.events.e1!.customFields.f1).toBeUndefined();
    // The definition belongs to the trip. Taking the field off one event says
    // nothing about the others, and the Fields page is where it is deleted.
    expect(doc.fieldDefs.f1!.deletedAt).toBeUndefined();

    doc = restoreField(doc, 'e1' as EventId, held, ada);
    expect(doc.events.e1!.customFields.f1).toEqual({ kind: 'number', number: 1200 });
  });

  it('lets a removal made offline merge with an edit made elsewhere', () => {
    let doc = trip();
    doc = updateEvent(doc, 'e1' as EventId, { city: 'Kyoto', description: 'morning' }, ada);

    const [mine, theirs] = fork(doc);
    const cleared = clearField(mine, 'e1' as EventId, 'city', ada);
    const edited = updateEvent(theirs, 'e1' as EventId, { description: 'afternoon' }, bo);

    // Each side touched its own keys, so the merge keeps both decisions rather
    // than one whole event winning.
    for (const merged of bothWays(cleared, edited)) {
      expect(merged.events.e1!.city).toBeUndefined();
      expect(merged.events.e1!.description).toBe('afternoon');
    }
  });
});
