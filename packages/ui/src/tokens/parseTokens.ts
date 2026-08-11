/**
 * Reads the token CSS and resolves each custom property to a literal value.
 *
 * The CSS files are the source of truth — they are what the browser loads, and
 * they are what a designer edits. Rather than restating the palette in
 * TypeScript and letting the two drift, this parses those same files so the
 * contrast tests and the Storybook reference page assert against what ships.
 */

export type ThemeName = 'light' | 'dark';

const DECLARATION = /--([\w-]+)\s*:\s*([^;]+);/g;
const VAR_REFERENCE = /var\(\s*--([\w-]+)\s*(?:,\s*([^)]*))?\)/;

/**
 * Comments are stripped before anything else. They are prose, and prose in
 * these files contains both commas and token names, either of which would
 * otherwise be read as part of a selector or as a declaration.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Splits a stylesheet into blocks and keeps the declarations from those whose
 * selector list contains a matching selector. Nested at-rules are not used in
 * the token files, so a brace-counting parser would buy nothing over this.
 */
function collectDeclarations(css: string, selectorMatches: (selector: string) => boolean) {
  const declarations = new Map<string, string>();

  for (const block of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = block[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (selectors.some((s) => s.startsWith('@'))) continue;
    if (!selectors.some(selectorMatches)) continue;

    for (const declaration of block[2]!.matchAll(DECLARATION)) {
      declarations.set(declaration[1]!, declaration[2]!.trim());
    }
  }

  return declarations;
}

/** `:root` and `[data-theme='light']` both carry the light mapping. */
function isBaseSelector(selector: string): boolean {
  return selector === ':root' || selector === "[data-theme='light']";
}

function isDarkSelector(selector: string): boolean {
  return selector === "[data-theme='dark']";
}

/** Follows `var()` chains until a literal falls out. */
function resolve(name: string, raw: Map<string, string>, seen = new Set<string>()): string | null {
  if (seen.has(name)) return null; // A cycle; report as unresolvable rather than hanging.
  seen.add(name);

  const value = raw.get(name);
  if (value === undefined) return null;

  const reference = VAR_REFERENCE.exec(value);
  if (!reference) return value;

  const resolved = resolve(reference[1]!, raw, seen);
  if (resolved !== null) return resolved;

  // `var(--missing, fallback)` — use the fallback.
  return reference[2]?.trim() ?? null;
}

export interface ResolvedTokens {
  /** Every custom property, resolved to a literal. */
  values: Map<string, string>;
  /** The raw declaration, for showing which ramp step a role points at. */
  references: Map<string, string>;
}

export function resolveTokens(
  primitivesCss: string,
  semanticCss: string,
  theme: ThemeName,
): ResolvedTokens {
  const raw = new Map<string, string>();

  for (const [name, value] of collectDeclarations(primitivesCss, isBaseSelector)) {
    raw.set(name, value);
  }
  for (const [name, value] of collectDeclarations(semanticCss, isBaseSelector)) {
    raw.set(name, value);
  }
  if (theme === 'dark') {
    for (const [name, value] of collectDeclarations(semanticCss, isDarkSelector)) {
      raw.set(name, value);
    }
  }

  const values = new Map<string, string>();
  for (const name of raw.keys()) {
    const resolved = resolve(name, raw);
    if (resolved !== null) values.set(name, resolved);
  }

  return { values, references: raw };
}
