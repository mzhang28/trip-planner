import {
  eventSearchText,
  liveEvents,
  type Instant,
  type TripDoc,
  type TripEvent,
} from '@trip/crdt';
import MiniSearch from 'minisearch';
import { parseDate } from './dates';

export type SearchResult =
  | { kind: 'event'; id: string; label: string; detail: string; event: TripEvent }
  | { kind: 'day'; id: string; label: string; detail: string; at: Instant }
  | { kind: 'command'; id: string; label: string; detail: string; command: CommandId };

export type CommandId = 'new-event' | 'today' | 'share';

const COMMANDS: Array<{ command: CommandId; label: string; keywords: string }> = [
  { command: 'new-event', label: 'Add an event', keywords: 'new add create event' },
  { command: 'today', label: 'Go to today', keywords: 'today now jump' },
  { command: 'share', label: 'Share this trip', keywords: 'share invite link people' },
];

/**
 * Builds the index the search box queries.
 *
 * Built in the browser from the document rather than asked of the server, so it
 * answers with no network and returns while the person is still typing. The
 * text it indexes comes from the same function the server's full-text index
 * uses, so a field is findable in both places or in neither.
 */
export function buildIndex(doc: TripDoc | undefined) {
  const events = liveEvents(doc);

  const index = new MiniSearch<{ id: string; text: string; name: string }>({
    fields: ['name', 'text'],
    storeFields: ['id'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      // A match on the name is what the person almost always meant, so it
      // outranks a match buried in a description or a link title.
      boost: { name: 3 },
    },
  });

  index.addAll(
    events.map((event) => ({
      id: event.id,
      name: event.name,
      text: eventSearchText(event, doc?.fieldDefs ?? {}),
    })),
  );

  return { index, byId: new Map(events.map((event) => [event.id, event])) };
}

export interface SearchContext {
  homeTimezone: string;
  now?: Instant;
  limit?: number;
}

/**
 * Answers one query with everything it could mean at once.
 *
 * Typing "aug 14" is as likely to mean "take me to that day" as it is to be the
 * name of something, and "share" could be either a thing or an action. Rather
 * than guessing which, all three kinds come back grouped, and the person picks.
 */
export function search(
  query: string,
  { index, byId }: ReturnType<typeof buildIndex>,
  { homeTimezone, now, limit = 8 }: SearchContext,
): SearchResult[] {
  const text = query.trim();
  if (!text) return [];

  const results: SearchResult[] = [];

  const date = parseDate(text, homeTimezone, now);
  if (date) {
    results.push({
      kind: 'day',
      id: `day:${date.at}`,
      label: date.label,
      detail: 'Jump to this day',
      at: date.at,
    });
  }

  for (const hit of index.search(text).slice(0, limit)) {
    const event = byId.get(hit.id as string);
    if (!event) continue;

    results.push({
      kind: 'event',
      id: event.id,
      label: event.name,
      detail: event.city ?? event.location?.label ?? 'Event',
      event,
    });
  }

  const lower = text.toLowerCase();
  for (const command of COMMANDS) {
    if (command.keywords.includes(lower) || command.label.toLowerCase().includes(lower)) {
      results.push({
        kind: 'command',
        id: `command:${command.command}`,
        label: command.label,
        detail: 'Action',
        command: command.command,
      });
    }
  }

  return results;
}
