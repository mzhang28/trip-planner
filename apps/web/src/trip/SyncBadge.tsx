import type { TripState } from './TripStore';

/**
 * What the app is doing with this person's changes.
 *
 * Says what is true of their edits rather than what is true of the network. A
 * person who has just typed something wants to know it is safe, and "Offline"
 * on its own leaves them wondering whether it was.
 */
export function SyncBadge({ state }: { state: TripState | null }) {
  if (!state) return null;

  const { label, tone } = describe(state);

  return (
    <span
      data-testid="sync-status"
      className={`rounded-sm px-1.5 py-0.5 text-2xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function describe(state: TripState): { label: string; tone: string } {
  switch (state.phase) {
    case 'syncing':
      return { label: 'Saving…', tone: 'bg-idea-soft text-idea-text' };
    case 'pending':
      // Says what is true of the edit rather than guessing why. It is on this
      // device, everyone else will get it, and there is nothing to do.
      return { label: 'Saved on this device', tone: 'bg-pending-soft text-pending-text' };
    case 'resync-required':
      return { label: 'Reloading trip', tone: 'bg-pending-soft text-pending-text' };
    case 'idle':
      return { label: 'Saved', tone: 'bg-booked-soft text-booked-text' };
  }
}
