import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and lets a later Tailwind utility win over an earlier one in
 * the same group, so a caller passing `className="px-6"` overrides a component's
 * own `px-3` instead of the two both landing in the class list and the outcome
 * depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
