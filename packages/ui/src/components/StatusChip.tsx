import { BOOKING_STATUS_LABEL, type BookingStatus } from '@trip/crdt';
import { cn } from '../lib/cn';

/**
 * What each status is called on screen.
 *
 * These strings come from the data package so the app, exports, and agent tools
 * all use one vocabulary.
 */
export { BOOKING_STATUS_LABEL };

const CHIP_STYLES: Record<BookingStatus, string> = {
  idea: 'bg-idea-soft text-idea-text',
  booked: 'bg-booked-soft text-booked-text',
};

export interface StatusChipProps {
  status: BookingStatus;
  className?: string;
}

export function StatusChip({ status, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs font-medium',
        CHIP_STYLES[status],
        className,
      )}
    >
      {/*
        A dot in the spine's own colour, so the chip and the card edge read as
        one system rather than two ways of saying the same thing.
      */}
      <span
        aria-hidden="true"
        className="status-spine size-1.5 rounded-full"
        data-status={status}
      />
      {BOOKING_STATUS_LABEL[status]}
    </span>
  );
}
