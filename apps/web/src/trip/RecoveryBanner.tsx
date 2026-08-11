import { Button } from '@trip/ui';
import type { TripStore } from './TripStore';
import type { TripState } from './TripStore';

/**
 * Offers back the changes that were set aside when the local copy was replaced.
 *
 * This appears after the server has refused a document older than its last
 * tombstone sweep. Replacing it is the only safe answer — merging could put
 * deleted events back — but the changes it was carrying were somebody's work,
 * so they were kept and are offered here rather than quietly dropped.
 *
 * Both buttons are given equal weight. Neither answer is obviously right: the
 * edits might be a week of planning or one stray keystroke, and only the person
 * who made them knows which.
 */
export function RecoveryBanner({ state, store }: { state: TripState; store: TripStore }) {
  const count = state.recoverableChanges;
  if (!count) return null;

  return (
    <div
      role="status"
      data-testid="recovery-banner"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-pending bg-pending-soft px-3 py-2.5"
    >
      <p className="min-w-0 flex-1 text-sm text-pending-text">
        This trip was reloaded from the server because this device had been away too long.{' '}
        {count === 1 ? 'One change' : `${count} changes`} made here had not been sent, and{' '}
        {count === 1 ? 'it was' : 'they were'} kept.
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onPress={() => void store.recoverSetAside()}>
          Put {count === 1 ? 'it' : 'them'} back
        </Button>
        <Button size="sm" variant="ghost" onPress={() => void store.discardSetAside()}>
          Discard
        </Button>
      </div>
    </div>
  );
}
