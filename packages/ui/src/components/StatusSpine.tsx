import type { BookingStatus } from '@trip/crdt';
import { cn } from '../lib/cn';

export interface StatusSpineProps {
  status: BookingStatus;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

/**
 * The mark that says whether an event is flexible or confirmed.
 *
 * Purely decorative to a screen reader: the status is already announced in
 * words by the chip beside it, and repeating it here would make every card read
 * its status twice.
 */
export function StatusSpine({ status, orientation = 'vertical', className }: StatusSpineProps) {
  return (
    <span
      aria-hidden="true"
      data-status={status}
      data-orientation={orientation}
      className={cn(
        'status-spine block shrink-0',
        // `self-stretch` rather than `h-full`: the card is a flex row whose
        // height comes from its content, so a percentage height resolves
        // against nothing and collapses to zero.
        // 4px rather than a hairline: below this the hatch and the dashes stop
        // being tellable apart, and the pattern is the point.
        orientation === 'vertical' ? 'w-1 self-stretch' : 'h-1 w-full',
        className,
      )}
    />
  );
}
