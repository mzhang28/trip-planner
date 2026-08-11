import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { cn } from '../lib/cn';
import type { ButtonVariant } from './Button';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink data-hovered:bg-accent-hover data-pressed:bg-accent-hover',
  secondary:
    'bg-card text-ink border border-line-default shadow-xs data-hovered:bg-sunken data-pressed:bg-sunken',
  ghost: 'text-ink-secondary data-hovered:bg-sunken data-hovered:text-ink data-pressed:bg-sunken',
  danger: 'bg-danger text-danger-ink data-hovered:bg-danger-hover data-pressed:bg-danger-hover',
};

/*
 * Both sizes meet the 44px touch target from WCAG 2.5.8 through padding rather
 * than through the drawn box: the button looks 28 or 36 pixels across and is
 * still comfortable to hit on a phone.
 */
const SIZES = {
  sm: 'size-7 before:absolute before:-inset-2',
  md: 'size-9 before:absolute before:-inset-1',
} as const;

export interface IconButtonProps extends AriaButtonProps {
  /** Required. An icon on its own tells a screen reader nothing. */
  label: string;
  variant?: ButtonVariant;
  size?: keyof typeof SIZES;
  className?: string;
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: IconButtonProps) {
  return (
    <AriaButton
      {...props}
      aria-label={label}
      className={cn(
        'relative inline-flex cursor-pointer items-center justify-center rounded-md',
        'transition-colors duration-100 [&_svg]:size-4',
        'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    />
  );
}
