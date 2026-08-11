import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts the card onto the raised surface, for popovers and dialogs. */
  raised?: boolean;
}

export function Card({ raised = false, className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-lg border border-line',
        raised ? 'bg-raised shadow-md' : 'bg-card shadow-sm',
        className,
      )}
    />
  );
}
