export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'trip-planner:theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private browsing and blocked storage both throw here. Fall through to the
    // system preference rather than failing to render.
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function storeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // A theme that does not persist is better than one that throws on click.
  }
}

/** Fires when the OS preference changes, so `system` tracks it live. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Runs in a blocking <script> in the document head, before the first paint, so
 * a dark-theme user never sees a white flash. It is inlined as a string because
 * it has to execute before any module loads.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(c!=='light'&&c!=='dark'){c=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=c}catch(e){document.documentElement.dataset.theme='light'}})()`;
