import type { TripEvent } from '@trip/crdt';
import { Button, cn, coloredSurfaceStyle } from '@trip/ui';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { EventKindIcon } from './EventKind';

/** Above this many, deleting asks first rather than only offering undo. */
const ASK_ABOVE = 3;

export interface SelectionBarProps {
  selected: Set<string>;
  events: TripEvent[];
  /** The events on the day the list is anchored on, for "all in this day". */
  dayEvents: TripEvent[];
  /** That day, written out. The scope was a day nobody could see named. */
  dayLabel: string;
  onSelectAll: (ids: string[]) => void;
  onClear: () => void;
  onDelete: () => void;
  onMerge: () => void;
}

/**
 * What can be done to the events that are ticked.
 *
 * Pinned to the bottom rather than folded into the header: on a phone the
 * bottom of the screen is where a thumb already is, and the actions here are
 * ones you reach for immediately after ticking something.
 */
export function SelectionBar({
  selected,
  events,
  dayEvents,
  dayLabel,
  onSelectAll,
  onClear,
  onDelete,
  onMerge,
}: SelectionBarProps) {
  const [asking, setAsking] = useState(false);

  if (selected.size === 0) return null;

  return (
    <div
      role="region"
      aria-label="Selected events"
      data-testid="selection-bar"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised px-4 py-3 shadow-lg',
        'flex flex-wrap items-center gap-2 sm:px-6',
      )}
    >
      <span aria-live="polite" className="text-sm font-medium text-ink">
        {selected.size} selected
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onPress={() => onSelectAll(dayEvents.map((event) => event.id))}>
          All on {dayLabel}
        </Button>
        <Button size="sm" onPress={() => onSelectAll(events.map((event) => event.id))}>
          All in the trip
        </Button>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onPress={onMerge}
          // Merging one thing into itself is not an operation.
          isDisabled={selected.size < 2}
        >
          Merge
        </Button>
        {/*
          A handful can be taken back from the message that follows. A long
          selection is worth a question first: it is the one case where a
          mis-aimed press costs an afternoon of planning.
        */}
        {asking ? (
          <>
            <span className="text-sm text-ink">Delete {selected.size} events?</span>
            <Button size="sm" variant="danger" data-testid="confirm-bulk-delete" onPress={onDelete}>
              Delete them
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setAsking(false)}>
              Keep them
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="danger"
              onPress={() => (selected.size > ASK_ABOVE ? setAsking(true) : onDelete())}
            >
              <Trash2 className="size-3.5" />
              Delete {selected.size}
            </Button>
            <Button size="sm" variant="ghost" onPress={onClear}>
              <X className="size-3.5" />
              Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export interface MergePreviewProps {
  primary: TripEvent;
  others: TripEvent[];
  onChangePrimary: (eventId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * What the merge will keep, before it happens.
 *
 * Merging folds several events into one and tombstones the rest, so it is worth
 * showing which name and place survive. The rules are fixed rather than asked
 * about field by field: a dialog with twelve choices takes longer than doing
 * the merge by hand.
 */
export function MergePreview({
  primary,
  others,
  onChangePrimary,
  onConfirm,
  onCancel,
}: MergePreviewProps) {
  const all = [primary, ...others];

  return (
    <div className="fixed inset-0 z-60 grid place-items-center bg-overlay p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Merge events"
        data-testid="merge-preview"
        className="w-full max-w-md rounded-lg border border-line bg-raised p-5 shadow-lg"
      >
        <h2 className="mb-1 text-lg">Merge {all.length} events</h2>
        <p className="mb-4 text-sm text-ink-secondary">
          They become one event. It keeps the earliest start, a span covering all of them, every
          link and file, and is Confirmed if any of them is Confirmed. Pick which one gives the
          name.
        </p>

        <fieldset className="mb-4 flex flex-col gap-1">
          <legend className="sr-only">Which event gives the name</legend>
          {all.map((event) => (
            <label
              key={event.id}
              style={coloredSurfaceStyle(event.color)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken"
            >
              <input
                type="radio"
                name="merge-primary"
                checked={event.id === primary.id}
                onChange={() => onChangePrimary(event.id)}
              />
              <EventKindIcon kind={event.kind} className="size-3.5 shrink-0 text-ink-muted" />
              <span className="truncate">{event.name}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onPress={onConfirm}>
            Merge into “{primary.name}”
          </Button>
        </div>
      </div>
    </div>
  );
}
