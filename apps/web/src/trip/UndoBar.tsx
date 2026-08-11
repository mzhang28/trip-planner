import { Button } from '@trip/ui';
import { useEffect } from 'react';

export interface UndoBarProps {
  /** What was done, in the past tense: "Deleted Fushimi Inari". */
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}

/** How long the offer stands before the deletion is just a deletion. */
const SECONDS = 10;

/**
 * The way back from something that has already happened.
 *
 * Deleting an event took effect with nothing said and no way back short of
 * typing it in again. A confirmation before every delete would tax the common
 * case to protect the rare one; saying what happened and offering to undo it
 * costs nothing when the delete was meant.
 */
export function UndoBar({ message, onUndo, onDismiss }: UndoBarProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [onDismiss, message]);

  return (
    <div
      role="status"
      data-testid="undo-bar"
      className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-3 border-t border-line bg-raised px-4 py-3 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:rounded-lg sm:border"
    >
      <span className="text-sm text-ink">{message}</span>

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" onPress={onUndo}>
          Undo
        </Button>
        <Button size="sm" variant="ghost" onPress={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
