import type { BookingStatus } from '@trip/crdt';
import { cn } from '../lib/cn';

/**
 * What each status is called on screen.
 *
 * "Booked" alone would leave the person wondering whether anything else is
 * outstanding, so the settled state says so. These strings are the vocabulary
 * for the whole app: the chip, the filter, and the bulk-edit menu all use them,
 * because a control that renames an action between screens makes people relearn
 * it each time.
 */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  idea: 'Idea',
  in_progress: 'In progress',
  booked: 'Booked and ready',
};

/** The short form, for a column too narrow for the full label. */
export const BOOKING_STATUS_SHORT_LABEL: Record<BookingStatus, string> = {
  idea: 'Idea',
  in_progress: 'Holding',
  booked: 'Booked',
};

const CHIP_STYLES: Record<BookingStatus, string> = {
  idea: 'bg-idea-soft text-idea-text',
  in_progress: 'bg-pending-soft text-pending-text',
  booked: 'bg-booked-soft text-booked-text',
};

export interface StatusChipProps {
  status: BookingStatus;
  /** Use the short label where the full one will not fit. */
  short?: boolean;
  className?: string;
}

export function StatusChip({ status, short = false, className }: StatusChipProps) {
  const label = short ? BOOKING_STATUS_SHORT_LABEL[status] : BOOKING_STATUS_LABEL[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs font-medium',
        CHIP_STYLES[status],
        className,
      )}
    >
      {/*
        A dot in the same pattern language as the spine, so the chip and the
        card edge read as one system rather than two ways of saying the thing.
      */}
      <span aria-hidden="true" className="status-spine size-1.5 rounded-full" data-status={status} />
      {label}
    </span>
  );
}
