import { Button } from '@trip/ui';
import type { DayKey } from '../lib/calendar';
import { formatTime } from '../lib/time';

/** Where a dragged event started and where letting go would put it. */
export interface MoveInQuestion {
  id: string;
  name: string;
  from: { day: DayKey; minutes: number };
  to: { day: DayKey; minutes: number };
}

/** "Friday 22 May, 09:00", on the clock the column it was dropped in is drawn on. */
function whenLabel(day: DayKey, minutes: number): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.parse(`${day}T12:00:00Z`));

  // Read as UTC because the minutes are already counted from the column's own
  // midnight: the zone has been applied, and applying one again would move it.
  return `${date}, ${formatTime(Date.parse(`${day}T00:00:00Z`) + minutes * 60_000, 'UTC')}`;
}

export interface ConfirmMoveProps {
  move: MoveInQuestion;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The question a confirmed event asks before a drag moves it.
 *
 * A confirmed event is one somebody has already paid for or arranged with a
 * hotel, and the plan is the only record of what was agreed to. Dragging is a
 * press and a slip of the wrist away from writing a different day over that,
 * with the whole gesture over before the mistake is visible. A flexible event
 * is asked nothing: moving it around is what being flexible means.
 */
export function ConfirmMove({ move, onConfirm, onCancel }: ConfirmMoveProps) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-overlay p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move a confirmed event"
        data-testid="confirm-move"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className="w-full max-w-md rounded-lg border border-line bg-raised p-5 shadow-lg"
      >
        <h2 className="mb-1 text-lg">Move a confirmed event?</h2>
        <p className="mb-4 text-sm text-ink-secondary">
          “{move.name || 'Unnamed'}” is Confirmed. Moving it changes the plan only; whoever holds
          the booking still has the old time.
        </p>

        <dl className="mb-4 flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-muted">Now</dt>
            <dd className="text-ink">{whenLabel(move.from.day, move.from.minutes)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-muted">Moving to</dt>
            <dd className="text-ink">{whenLabel(move.to.day, move.to.minutes)}</dd>
          </div>
        </dl>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" data-testid="confirm-move-cancel" onPress={onCancel}>
            Leave it
          </Button>
          {/*
            Focused on opening, so Enter takes the move somebody meant to make
            and Escape leaves it. The drag has already ended, so nothing is
            waiting on the pointer.
          */}
          <Button autoFocus variant="primary" data-testid="confirm-move-ok" onPress={onConfirm}>
            Move it
          </Button>
        </div>
      </div>
    </div>
  );
}
