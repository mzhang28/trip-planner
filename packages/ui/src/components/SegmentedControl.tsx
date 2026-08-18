import { Radio, RadioGroup, type RadioGroupProps } from 'react-aria-components';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** A letter or two for narrow rows, where the label is the option's name. */
  short?: string;
}

export interface SegmentedControlProps<T extends string>
  extends Omit<RadioGroupProps, 'children' | 'value' | 'onChange'> {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shows each option's short form, for a row with no space for words. */
  compact?: boolean;
  className?: string;
}

/**
 * A row of mutually exclusive choices, used for the month/week/day switch and
 * the light/dark/system switch.
 *
 * Built on a radio group rather than a row of buttons so that arrow keys move
 * between the options and a screen reader announces "2 of 3" — which is what
 * makes it read as one control with a current value rather than three separate
 * things to press.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  compact = false,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup
      {...props}
      aria-label={label}
      value={value}
      onChange={(next) => onChange(next as T)}
      orientation="horizontal"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-line-default bg-sunken p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const short = compact ? option.short : undefined;

        return (
          <Radio
            key={option.value}
            value={option.value}
            // The word is still the name when only a letter is drawn, so the
            // control reads as Day, Week and Month however wide the row is.
            aria-label={short ? option.label : undefined}
            className={cn(
              'cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium whitespace-nowrap',
              'text-ink-muted transition-colors duration-100',
              'data-hovered:text-ink',
              'data-selected:bg-card data-selected:text-ink data-selected:shadow-xs',
              'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:outline-offset-1',
            )}
          >
            {short ?? option.label}
          </Radio>
        );
      })}
    </RadioGroup>
  );
}
