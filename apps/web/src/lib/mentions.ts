import type { TripDoc } from '@trip/crdt';

export type MentionKind = 'event' | 'place' | 'file';

export interface Mention {
  kind: MentionKind;
  /** The id of the thing referred to. The label is never the reference. */
  id: string;
  /** What was written at the time, kept only as a fallback. */
  writtenAs: string;
}

export type Segment = { type: 'text'; text: string } | ({ type: 'mention' } & Mention);

/*
 * A mention is stored as `@[label](kind:id)`.
 *
 * The id is the reference and the label is a copy. Renaming an event updates
 * every mention of it, because the label shown is read from the document rather
 * than from what was typed. Storing the label alone would leave the text saying
 * something the trip no longer says.
 */
const MENTION = /@\[([^\]]*)\]\((event|place|file):([^)]+)\)/g;

export function parseMentions(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MENTION)) {
    const at = match.index;
    if (at > cursor) segments.push({ type: 'text', text: text.slice(cursor, at) });

    segments.push({
      type: 'mention',
      kind: match[2] as MentionKind,
      id: match[3]!,
      writtenAs: match[1]!,
    });

    cursor = at + match[0].length;
  }

  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}

export function formatMention(kind: MentionKind, id: string, label: string): string {
  // Brackets and parentheses in a label would end the markup early.
  const safe = label.replace(/[[\]()]/g, '');
  return `@[${safe}](${kind}:${id})`;
}

export interface ResolvedMention extends Mention {
  /** What to show now, which may differ from what was written. */
  label: string;
  /** False when the thing referred to has gone. */
  resolved: boolean;
}

/**
 * Reads the current label for a mention out of the trip.
 *
 * An unresolved mention keeps what was written rather than disappearing: the
 * sentence still has to make sense, and a gap where a name was tells the reader
 * less than a name marked as gone.
 */
export function resolveMention(mention: Mention, doc: TripDoc | undefined): ResolvedMention {
  const events = Object.values(doc?.events ?? {});

  if (mention.kind === 'event') {
    const event = doc?.events?.[mention.id];
    return event && event.deletedAt === undefined
      ? { ...mention, label: event.name, resolved: true }
      : { ...mention, label: mention.writtenAs, resolved: false };
  }

  if (mention.kind === 'place') {
    const event = doc?.events?.[mention.id];
    const label = event?.location?.label;
    return label
      ? { ...mention, label, resolved: true }
      : { ...mention, label: mention.writtenAs, resolved: false };
  }

  for (const event of events) {
    const attachment = event.attachments[mention.id];
    if (attachment) return { ...mention, label: attachment.filename, resolved: true };
  }

  return { ...mention, label: mention.writtenAs, resolved: false };
}

export interface Suggestion {
  kind: MentionKind;
  id: string;
  label: string;
  detail: string;
}

/**
 * What `@` can be completed to, ranked by what the person has typed so far.
 *
 * Draws on the same three things a mention can refer to, so the menu and the
 * markup can never disagree about what exists.
 */
export function mentionSuggestions(
  query: string,
  doc: TripDoc | undefined,
  exclude?: string,
): Suggestion[] {
  const needle = query.trim().toLowerCase();
  const suggestions: Suggestion[] = [];

  for (const event of Object.values(doc?.events ?? {})) {
    if (event.deletedAt !== undefined || event.id === exclude) continue;

    suggestions.push({ kind: 'event', id: event.id, label: event.name, detail: 'Event' });

    if (event.location?.label) {
      suggestions.push({
        kind: 'place',
        id: event.id,
        label: event.location.label,
        detail: 'Place',
      });
    }

    for (const [id, attachment] of Object.entries(event.attachments)) {
      suggestions.push({ kind: 'file', id, label: attachment.filename, detail: 'File' });
    }
  }

  return suggestions
    .filter((suggestion) => !needle || suggestion.label.toLowerCase().includes(needle))
    .slice(0, 8);
}

/** Where a mention is being typed, or null when the caret is not in one. */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; from: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;

  const query = before.slice(at + 1);

  // An @ only starts a mention at a word boundary, and a space ends it. Without
  // that an email address in the middle of a sentence opens the menu.
  const preceding = at === 0 ? ' ' : before[at - 1]!;
  if (!/\s/.test(preceding)) return null;
  if (/[\s\]]/.test(query)) return null;

  return { query, from: at };
}

/** The plain reading of a description, for search and for a summary line. */
export function mentionsToText(text: string, doc: TripDoc | undefined): string {
  return parseMentions(text)
    .map((segment) => (segment.type === 'text' ? segment.text : resolveMention(segment, doc).label))
    .join('');
}
