import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR_PALETTE,
  boldColor,
  boldInkColor,
  boldVariants,
  coloredSurfaceStyle,
  contrastBetween,
  mutedColor,
  mutedVariants,
  readableTextColor,
} from './color';

/*
 * The surfaces a coloured card lands on in the dark theme, copied from the
 * semantic layer: the week grid is the page, and every other list draws the
 * card. The palette is derived against these, so a change to either theme's
 * surface ramp should be felt here.
 */
const DARK_PAGE = '#1A2029';
const DARK_CARD = '#2A313B';
const LIGHT_CARD = '#FFFFFF';

describe('default color palette', () => {
  it('contains 32 distinct colors with a variant for each theme', () => {
    expect(DEFAULT_COLOR_PALETTE).toHaveLength(32);

    for (const variant of ['bold', 'muted', 'boldDark', 'mutedDark'] as const) {
      expect(new Set(DEFAULT_COLOR_PALETTE.map((color) => color[variant])).size, variant).toBe(32);
    }

    for (const color of DEFAULT_COLOR_PALETTE) {
      expect(color.value).toBe(color.bold);
      expect(new Set([color.bold, color.muted, color.boldDark, color.mutedDark]).size).toBe(4);
    }
  });

  it('chooses readable text for every swatch in both themes', () => {
    for (const color of DEFAULT_COLOR_PALETTE) {
      for (const variant of ['bold', 'muted', 'boldDark', 'mutedDark'] as const) {
        const swatch = color[variant];
        expect(
          contrastBetween(swatch, readableTextColor(swatch)),
          `${color.name} ${variant}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the dark accent visible on the dark theme surfaces', () => {
    for (const color of DEFAULT_COLOR_PALETTE) {
      expect(contrastBetween(color.boldDark, DARK_PAGE), color.name).toBeGreaterThanOrEqual(3);
      expect(contrastBetween(color.boldDark, DARK_CARD), color.name).toBeGreaterThanOrEqual(3);
      expect(contrastBetween(color.boldDark, color.mutedDark), color.name).toBeGreaterThanOrEqual(
        2,
      );
    }
  });

  it('keeps a dark surface off the surfaces it is drawn on', () => {
    for (const color of DEFAULT_COLOR_PALETTE) {
      expect(contrastBetween(color.mutedDark, DARK_PAGE), color.name).toBeGreaterThan(1.2);
      expect(contrastBetween(color.mutedDark, DARK_CARD), color.name).toBeGreaterThan(1.2);
    }
  });

  it('darkens the surface variant for dark and lightens the accent variant', () => {
    for (const color of DEFAULT_COLOR_PALETTE) {
      const onWhite = contrastBetween(color.muted, LIGHT_CARD)!;
      const onDark = contrastBetween(color.mutedDark, DARK_CARD)!;
      // A surface stays close to the sheet it sits on, in either direction.
      expect(onWhite, `${color.name} muted`).toBeLessThan(2);
      expect(onDark, `${color.name} mutedDark`).toBeLessThan(3);
      expect(contrastBetween(color.boldDark, DARK_PAGE)!, `${color.name} boldDark`).toBeGreaterThan(
        contrastBetween(color.bold, DARK_PAGE)!,
      );
    }
  });

  it('resolves any variant of a color to the requested one', () => {
    const navy = DEFAULT_COLOR_PALETTE.find((color) => color.name === 'Navy')!;

    for (const stored of [navy.bold, navy.muted, navy.boldDark, navy.mutedDark]) {
      expect(boldVariants(stored)).toEqual({ light: navy.bold, dark: navy.boldDark });
      expect(mutedVariants(stored)).toEqual({ light: navy.muted, dark: navy.mutedDark });
    }
  });

  it('derives both variants for a color from outside the palette', () => {
    const variants = mutedVariants('#3366CC')!;

    expect(variants.light).toBe('#DAE3F6');
    expect(contrastBetween(variants.dark, readableTextColor(variants.dark))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastBetween(variants.dark, DARK_PAGE)).toBeGreaterThan(1.2);
    // The accent a person picked is theirs in the light theme.
    expect(boldVariants('#3366CC')?.light).toBe('#3366CC');
  });

  it('uses light text over dark colors and dark text over light colors', () => {
    expect(readableTextColor('#1E3A8A')).toBe('#FFFFFF');
    expect(readableTextColor('#FACC15')).toBe('#111827');
  });

  it('leaves a value that is not a color alone', () => {
    expect(boldColor(undefined)).toBeUndefined();
    expect(mutedColor('var(--accent)')).toBeUndefined();
    expect(coloredSurfaceStyle('')).toBeUndefined();
  });
});

describe('themed color values', () => {
  const navy = DEFAULT_COLOR_PALETTE.find((color) => color.name === 'Navy')!;

  it('pairs the two themes into one CSS value', () => {
    expect(boldColor(navy.bold)).toBe(`light-dark(${navy.bold}, ${navy.boldDark})`);
    expect(mutedColor(navy.bold)).toBe(`light-dark(${navy.muted}, ${navy.mutedDark})`);
    // Navy is dark in the light theme and light in the dark theme, so the ink
    // over it flips with the theme.
    expect(boldInkColor(navy.bold)).toBe('light-dark(#FFFFFF, #111827)');
  });

  it('applies the readable foreground to semantic text on a colored surface', () => {
    const style = coloredSurfaceStyle(navy.bold);
    const ink = `light-dark(#111827, #FFFFFF)`;

    expect(style?.backgroundColor).toBe(`light-dark(${navy.muted}, ${navy.mutedDark})`);
    expect(style?.borderColor).toBe(`light-dark(${navy.bold}, ${navy.boldDark})`);
    expect(style?.color).toBe(ink);
    expect(style?.['--text-primary']).toBe(ink);
    expect(style?.['--text-muted']).toBe(ink);
    expect(style?.['--surface-sunken']).toBe(
      `light-dark(color-mix(in srgb, ${navy.muted}, #111827 10%), ` +
        `color-mix(in srgb, ${navy.mutedDark}, #FFFFFF 10%))`,
    );
  });
});
