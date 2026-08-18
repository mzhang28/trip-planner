import { cn } from '@trip/ui';
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';

export interface PaletteChip {
  key: string;
  label: string;
}

export interface FieldPaletteProps {
  chips: PaletteChip[];
  onAdd: (key: string) => void;
  /** How many to show before the rest are folded away. */
  collapsedCount?: number;
}

/**
 * The fields this event does not have yet, offered one at a time.
 *
 * An event starts as a name and grows as things are decided, so the editor
 * shows what has been filled in rather than every box that could ever be
 * filled. Adding one is a click, and nothing is asked for that is not wanted.
 *
 * Only the first few are shown. The full set is long enough that laying it all
 * out would be the wall of fields this exists to avoid, and the common ones
 * come first.
 */
export function FieldPalette({ chips, onAdd, collapsedCount = 6 }: FieldPaletteProps) {
  const [expanded, setExpanded] = useState(false);

  if (chips.length === 0) return null;

  const shown = expanded ? chips : chips.slice(0, collapsedCount);
  const hidden = chips.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-2xs text-ink-muted">Add</span>

      {shown.map((chip) => (
        <button
          key={chip.key}
          type="button"
          data-testid={`add-field-${chip.key}`}
          onClick={() => onAdd(chip.key)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-line-default px-2 py-0.5',
            'text-2xs text-ink-secondary',
            'hover:border-accent hover:bg-accent-soft hover:text-accent-text',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          )}
        >
          <Plus aria-hidden="true" className="size-3" />
          {chip.label}
        </button>
      ))}

      {hidden > 0 && (
        <button
          type="button"
          data-testid="expand-palette"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          …and {hidden} more
          <ChevronDown aria-hidden="true" className="size-3" />
        </button>
      )}

      {expanded && chips.length > collapsedCount && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-full px-2 py-0.5 text-2xs text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          Show fewer
        </button>
      )}
    </div>
  );
}
