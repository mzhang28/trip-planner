import type { CustomValue, FieldDef, FieldDefId, TripEvent } from './types';

/**
 * Replaces `@[label](kind:id)` with the label that was written.
 *
 * Kept here rather than resolved against the trip: this runs over one event at
 * a time, and the written label is what the person typed and will search for.
 */
export function stripMentionMarkup(text: string): string {
  return text.replace(/@\[([^\]]*)\]\((?:event|place|file):[^)]+\)/g, '$1');
}

/**
 * Renders one custom field value the way it reads on screen.
 *
 * Findable by what it looks like, not by what it looks like in storage: a date
 * is a date rather than a number of milliseconds, an amount carries its
 * currency, and a choice is its label rather than its id.
 */
export function renderCustomValue(value: CustomValue, def: FieldDef | undefined): string {
  switch (value.kind) {
    case 'text':
      return value.text;

    case 'number':
      return def?.unit ? `${value.number} ${def.unit}` : String(value.number);

    case 'instant': {
      const date = new Date(value.at);
      if (Number.isNaN(date.getTime())) return '';
      // Both the machine form and a readable one, so "2026-08-14" and
      // "14 August 2026" each find it.
      const iso = date.toISOString().slice(0, 10);
      const readable = date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return `${iso} ${readable}`;
    }

    case 'bool':
      return value.bool ? 'yes' : 'no';

    case 'options': {
      const ids = Object.keys(value.selected);
      return ids.map((id) => def?.options?.[id]?.label ?? id).join(' ');
    }
  }
}

function money(value: CustomValue, def: FieldDef | undefined): string | null {
  if (value.kind !== 'number' || def?.type !== 'money' || !def.currency) return null;
  return `${def.currency} ${value.number}`;
}

/**
 * Everything about an event that is worth finding it by.
 *
 * One function, called by both the browser's MiniSearch index and the server's
 * FTS5 projection. Two implementations would drift, and the first sign would be
 * a field that is findable in the app but invisible to the MCP tool, or the
 * reverse.
 *
 * Custom field values are prefixed with their label, so searching for a field
 * name turns up the events where it is filled in: typing `dress` finds the
 * events that have a "Dress code".
 */
export function eventSearchText(
  event: TripEvent,
  fieldDefs: Record<FieldDefId, FieldDef> = {},
): string {
  const parts: (string | undefined)[] = [
    event.name,
    event.city,
    event.location?.label,
    event.location?.address,
    // Mentions are stored as markup. Indexing the raw form would make a
    // description findable by an id nobody has ever seen and not by the name
    // they actually read.
    event.description === undefined ? undefined : stripMentionMarkup(event.description),
    event.booking.note,
    event.booking.confirmationCode,
    event.transitIn?.note,
    event.flight?.airline,
    event.flight?.number,
    event.flight?.from,
    event.flight?.to,
    event.flight?.fromCity,
    event.flight?.toCity,
    event.flight?.seat,
    event.flight?.terminal,
    event.flight?.gate,
    event.transit?.fromCity,
    event.transit?.toCity,
    event.lodging?.address,
  ];

  for (const link of Object.values(event.links)) {
    parts.push(link.title, link.url);
  }

  for (const attachment of Object.values(event.attachments)) {
    parts.push(attachment.filename);
  }

  for (const [fieldId, value] of Object.entries(event.customFields)) {
    const def = fieldDefs[fieldId];
    const rendered = renderCustomValue(value, def);
    if (!rendered) continue;

    parts.push(def?.label ? `${def.label} ${rendered}` : rendered);

    const asMoney = money(value, def);
    if (asMoney) parts.push(asMoney);
  }

  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
