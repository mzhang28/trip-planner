import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  readStoredChoice,
  resolveTheme,
  storeChoice,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme';

export interface UseThemeResult {
  /** What the person picked, which may be `system`. */
  choice: ThemeChoice;
  /** What that currently renders as. */
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
}

export function useTheme(): UseThemeResult {
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    typeof window === 'undefined' ? 'system' : readStoredChoice(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(readStoredChoice()),
  );

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    storeChoice(next);
    setResolved(applyTheme(next));
  }, []);

  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystemTheme(() => setResolved(applyTheme('system')));
  }, [choice]);

  return { choice, resolved, setChoice };
}
