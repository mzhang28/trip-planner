import type { TripEvent } from '@trip/crdt';
import { cn } from '@trip/ui';
import { AlertTriangle } from 'lucide-react';
import { checkTransit, describeTransit } from '../lib/transit';

/**
 * The journey into an event, drawn between it and the one before.
 *
 * Sits in the gap rather than inside the card, because that is where the time
 * it describes actually is. When it does not fit, saying so here is what turns
 * a plan that looks fine into one someone can see is not.
 */
export function TransitLeg({
  event,
  previous,
}: {
  event: TripEvent;
  previous: TripEvent | undefined;
}) {
  const check = checkTransit(event, previous);
  const label = describeTransit(event);
  if (!check || !label) return null;

  return (
    <div
      data-testid="transit-leg"
      className={cn(
        'flex items-center gap-2 py-1 pl-6 text-2xs',
        check.tooTight ? 'text-pending-text' : 'text-ink-muted',
      )}
    >
      <span aria-hidden="true" className="h-4 w-px bg-line-strong" />

      <span>{label}</span>

      {event.transitIn?.note && <span className="truncate">· {event.transitIn.note}</span>}

      {check.tooTight && (
        <span className="flex items-center gap-1 rounded-sm bg-pending-soft px-1.5 py-0.5">
          <AlertTriangle aria-hidden="true" className="size-3" />
          {check.shortBy} min short of the gap
        </span>
      )}
    </div>
  );
}
