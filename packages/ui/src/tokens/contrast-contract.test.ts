import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastBetween } from '../lib/color';
import { CONTRAST_CONTRACT } from './contrast-contract';
import { resolveTokens, type ThemeName } from './parseTokens';

const primitivesCss = readFileSync(
  fileURLToPath(new URL('../styles/primitives.css', import.meta.url)),
  'utf8',
);
const semanticCss = readFileSync(
  fileURLToPath(new URL('../styles/semantic.css', import.meta.url)),
  'utf8',
);

const themes: ThemeName[] = ['light', 'dark'];

describe.each(themes)('%s theme', (theme) => {
  const { values } = resolveTokens(primitivesCss, semanticCss, theme);

  it.each(CONTRAST_CONTRACT)(
    '$foreground on $background clears $minRatio:1 ($usage)',
    ({ foreground, background, minRatio }) => {
      const fg = values.get(foreground);
      const bg = values.get(background);

      expect(fg, `--${foreground} is not defined`).toBeDefined();
      expect(bg, `--${background} is not defined`).toBeDefined();

      const ratio = contrastBetween(fg!, bg!);
      expect(
        ratio,
        `--${foreground} (${fg}) or --${background} (${bg}) is not an opaque colour`,
      ).not.toBeNull();

      // Reported to two places so a failure says how far off it is.
      expect(Number(ratio!.toFixed(2))).toBeGreaterThanOrEqual(minRatio);
    },
  );
});

describe('token hygiene', () => {
  it('defines every semantic role in both themes', () => {
    const light = resolveTokens(primitivesCss, semanticCss, 'light').values;
    const dark = resolveTokens(primitivesCss, semanticCss, 'dark').values;

    const roles = [...new Set(CONTRAST_CONTRACT.flatMap((p) => [p.foreground, p.background]))];
    for (const role of roles) {
      expect(light.has(role), `--${role} missing from the light theme`).toBe(true);
      expect(dark.has(role), `--${role} missing from the dark theme`).toBe(true);
    }
  });

  it('resolves every custom property to a literal, so no var() chain dead-ends', () => {
    for (const theme of themes) {
      const { values, references } = resolveTokens(primitivesCss, semanticCss, theme);
      for (const name of references.keys()) {
        expect(values.has(name), `--${name} does not resolve in the ${theme} theme`).toBe(true);
        expect(
          values.get(name),
          `--${name} still contains a var() in the ${theme} theme`,
        ).not.toMatch(/var\(/);
      }
    }
  });
});
