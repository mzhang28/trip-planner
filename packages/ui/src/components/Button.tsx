import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/*
 * Interaction states come from React Aria's data attributes rather than the CSS
 * pseudo-classes. `data-hovered` is not set during a touch drag the way :hover
 * is, and `data-pressed` covers pointer, keyboard, and touch alike, so the
 * states stay consistent across input methods.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink data-hovered:bg-accent-hover data-pressed:bg-accent-hover',
  secondary:
    'bg-card text-ink border border-line-default shadow-xs data-hovered:bg-sunken data-pressed:bg-sunken',
  ghost: 'text-ink-secondary data-hovered:bg-sunken data-hovered:text-ink data-pressed:bg-sunken',
  danger: 'bg-danger text-danger-ink data-hovered:bg-danger-hover data-pressed:bg-danger-hover',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
};

export interface ButtonProps extends AriaButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap',
        'transition-colors duration-100',
        // Only set when focus arrived by keyboard, so pointer users never see a
        // ring and keyboard users always do.
        'data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-focus',
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    />
  );
}
