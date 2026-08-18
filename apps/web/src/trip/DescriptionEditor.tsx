import type { TripDoc } from '@trip/crdt';
import { cn } from '@trip/ui';
import { useId, useRef, useState } from 'react';
import {
  activeMentionQuery,
  formatMention,
  mentionSuggestions,
  parseMentions,
  resolveMention,
  type MentionKind,
} from '../lib/mentions';

export interface DescriptionEditorProps {
  value: string;
  doc: TripDoc | undefined;
  /** The event being edited, so it is not offered as a mention of itself. */
  eventId: string;
  onChange: (value: string) => void;
  onOpenEvent: (eventId: string) => void;
}

/**
 * A description that can point at the rest of the trip.
 *
 * Typing `@` offers the events, places, and files on this trip. What is stored
 * is the id, so renaming an event renames every mention of it -- the label on
 * screen is read from the document rather than from what was typed.
 */
export function DescriptionEditor({
  value,
  doc,
  eventId,
  onChange,
  onOpenEvent,
}: DescriptionEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState<{ query: string; from: number } | null>(null);
  const [active, setActive] = useState(0);

  const suggestions = query ? mentionSuggestions(query.query, doc, eventId) : [];
  const open = Boolean(query) && suggestions.length > 0;

  function update(next: string, caret: number) {
    setDraft(next);
    setQuery(activeMentionQuery(next, caret));
    setActive(0);
  }

  function insert(kind: MentionKind, id: string, label: string) {
    if (!query) return;

    const caret = area.current?.selectionStart ?? draft.length;
    const markup = formatMention(kind, id, label);
    const next = `${draft.slice(0, query.from)}${markup} ${draft.slice(caret)}`;

    setDraft(next);
    setQuery(null);
    onChange(next);

    // Put the caret after what was just inserted, so typing carries on where
    // the person was rather than jumping to the end.
    requestAnimationFrame(() => {
      const at = query.from + markup.length + 1;
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${listId}-input`} className="text-xs font-medium text-ink-secondary">
        Description
      </label>

      <div className="relative">
        <textarea
          id={`${listId}-input`}
          ref={area}
          rows={3}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          value={draft}
          placeholder="Go before the coaches arrive. Type @ to point at something."
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (!open) return;

            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((current) => Math.min(current + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const choice = suggestions[active];
              if (choice) insert(choice.kind, choice.id, choice.label);
            } else if (e.key === 'Escape') {
              setQuery(null);
            }
          }}
          onBlur={() => {
            setTimeout(() => setQuery(null), 120);
            if (draft !== value) onChange(draft);
          }}
          className={cn(
            'w-full resize-y rounded-md border border-line-input bg-card px-2.5 py-2 text-ink',
            'placeholder:text-ink-placeholder',
            'focus:border-accent focus:outline-2 focus:-outline-offset-1 focus:outline-focus',
          )}
        />

        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Things to point at"
            className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-line bg-raised py-1 shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.kind}:${suggestion.id}`}>
                <div
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={() => insert(suggestion.kind, suggestion.id, suggestion.label)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5',
                    index === active && 'bg-accent-soft',
                  )}
                >
                  <span className="truncate text-sm text-ink">{suggestion.label}</span>
                  <span className="shrink-0 text-2xs text-ink-muted">{suggestion.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {draft.includes('@[') && (
        <div className="rounded-md bg-sunken px-2.5 py-2 text-xs text-ink-secondary">
          <Description text={draft} doc={doc} onOpenEvent={onOpenEvent} />
        </div>
      )}
    </div>
  );
}

/**
 * A description as it reads, with its mentions resolved against the trip now.
 *
 * A mention whose target has gone keeps the words that were written and is
 * marked as unresolved, because a gap where a name was tells the reader less
 * than a name marked gone.
 */
export function Description({
  text,
  doc,
  onOpenEvent,
}: {
  text: string;
  doc: TripDoc | undefined;
  onOpenEvent: (eventId: string) => void;
}) {
  return (
    <p className="whitespace-pre-wrap">
      {parseMentions(text).map((segment, index) => {
        if (segment.type === 'text') return <span key={index}>{segment.text}</span>;

        const mention = resolveMention(segment, doc);

        if (!mention.resolved) {
          return (
            <span
              key={index}
              data-testid="mention-gone"
              title="This is no longer on the trip"
              className="rounded-sm bg-pending-soft px-1 text-pending-text line-through"
            >
              {mention.label}
            </span>
          );
        }

        return (
          <button
            key={index}
            type="button"
            data-testid="mention"
            onClick={() => onOpenEvent(mention.id)}
            className="rounded-sm bg-accent-soft px-1 text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {mention.label}
          </button>
        );
      })}
    </p>
  );
}
