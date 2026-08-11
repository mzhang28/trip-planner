import { useTheme } from '../theme/useTheme';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

export interface ThemeToggleProps {
  className?: string;
}

/**
 * Picks the theme. `System` follows the operating system and keeps following it,
 * so someone whose machine switches at sunset does not have to come back here.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { choice, setChoice } = useTheme();

  return (
    <SegmentedControl
      label="Theme"
      options={OPTIONS}
      value={choice}
      onChange={setChoice}
      className={className}
    />
  );
}
