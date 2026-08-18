import type { TripDoc, TripEvent } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import {
  activeMentionQuery,
  formatMention,
  mentionSuggestions,
  mentionsToText,
  parseMentions,
  resolveMention,
} from './mentions';

function event(overrides: Partial<TripEvent>): TripEvent {
  return {
    id: 'e1',
    kind: 'activity',
    name: 'Fushimi Inari',
    booking: { status: 'idea' },
    links: {},
    attachments: {},
    customFields: {},
    updatedAt: 0,
    updatedBy: 'u1',
    ...overrides,
  };
}

const doc = {
  meta: { name: 'Japan', homeTimezone: 'Asia/Tokyo' },
  fieldDefs: {},
  events: {
    e1: event({
      id: 'e1',
      name: 'Fushimi Inari',
      location: { label: 'Fushimi Inari Taisha' },
      attachments: {
        a1: {
          blobHash: 'x',
          filename: 'tickets.pdf',
          mime: 'application/pdf',
          size: 1,
          addedAt: 0,
        },
      },
    }),
    e2: event({ id: 'e2', name: 'Nishiki Market' }),
    gone: event({ id: 'gone', name: 'Cancelled', deletedAt: 1 }),
  },
} as unknown as TripDoc;

describe('parsing mentions', () => {
  it('splits text and mentions apart', () => {
    const segments = parseMentions('Meet at @[Fushimi Inari](event:e1) then eat');

    expect(segments).toEqual([
      { type: 'text', text: 'Meet at ' },
      { type: 'mention', kind: 'event', id: 'e1', writtenAs: 'Fushimi Inari' },
      { type: 'text', text: ' then eat' },
    ]);
  });

  it('handles several in a row and all three kinds', () => {
    const segments = parseMentions('@[A](event:e1)@[B](place:e2) and @[C](file:a1)').filter(
      (s) => s.type === 'mention',
    );

    expect(segments.map((s) => s.type === 'mention' && s.kind)).toEqual(['event', 'place', 'file']);
  });

  it('leaves ordinary text with an at sign alone', () => {
    expect(parseMentions('write to me@example.com')).toEqual([
      { type: 'text', text: 'write to me@example.com' },
    ]);
  });

  it('round-trips what it formats', () => {
    const markup = formatMention('event', 'e1', 'Fushimi Inari');
    expect(parseMentions(markup)[0]).toMatchObject({ kind: 'event', id: 'e1' });
  });

  it('strips brackets from a label, which would end the markup early', () => {
    const markup = formatMention('event', 'e1', 'Dinner (maybe) [tbc]');
    expect(parseMentions(markup)).toHaveLength(1);
    expect(parseMentions(markup)[0]).toMatchObject({ id: 'e1' });
  });
});

describe('resolving mentions', () => {
  it('shows the current name, not the one that was typed', () => {
    const [mention] = parseMentions('@[Old name](event:e1)');
    const resolved = resolveMention(mention as never, doc);

    // Renaming an event renames every mention of it, which is the whole reason
    // the id is the reference and the label is a copy.
    expect(resolved.label).toBe('Fushimi Inari');
    expect(resolved.resolved).toBe(true);
  });

  it('resolves a place to the event location and a file to its name', () => {
    expect(resolveMention(parseMentions('@[x](place:e1)')[0] as never, doc).label).toBe(
      'Fushimi Inari Taisha',
    );
    expect(resolveMention(parseMentions('@[x](file:a1)')[0] as never, doc).label).toBe(
      'tickets.pdf',
    );
  });

  it('keeps what was written when the thing is gone, and says it is gone', () => {
    for (const markup of ['@[Cancelled](event:gone)', '@[Missing](event:nope)']) {
      const resolved = resolveMention(parseMentions(markup)[0] as never, doc);

      // A gap where a name was tells the reader less than a name marked gone.
      expect(resolved.resolved).toBe(false);
      expect(resolved.label).not.toBe('');
    }
  });

  it('reads a description as plain words', () => {
    expect(mentionsToText('Go to @[Old](event:e1) first', doc)).toBe('Go to Fushimi Inari first');
  });
});

describe('suggesting mentions', () => {
  it('offers events, their places, and their files', () => {
    const kinds = new Set(mentionSuggestions('', doc).map((s) => s.kind));
    expect(kinds).toEqual(new Set(['event', 'place', 'file']));
  });

  it('narrows as you type', () => {
    expect(mentionSuggestions('nishiki', doc).map((s) => s.label)).toEqual(['Nishiki Market']);
  });

  it('leaves out deleted events and the event being edited', () => {
    const labels = mentionSuggestions('', doc, 'e2').map((s) => s.label);

    expect(labels).not.toContain('Cancelled');
    expect(labels).not.toContain('Nishiki Market');
  });
});

describe('spotting a mention being typed', () => {
  it('finds the query after an at sign at a word boundary', () => {
    expect(activeMentionQuery('Meet at @fush', 13)).toEqual({ query: 'fush', from: 8 });
    expect(activeMentionQuery('@fush', 5)).toEqual({ query: 'fush', from: 0 });
  });

  it('ignores an at sign inside a word, so an email is left alone', () => {
    expect(activeMentionQuery('me@example.com', 14)).toBeNull();
  });

  it('closes once the mention is finished or a space is typed', () => {
    expect(activeMentionQuery('@fush and', 9)).toBeNull();
    expect(activeMentionQuery('@[A](event:e1)', 14)).toBeNull();
  });
});
