import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR_PALETTE,
  coloredSurfaceStyle,
  contrastBetween,
  readableTextColor,
} from './color';

describe('default color palette', () => {
  it('contains 32 distinct colors', () => {
    expect(DEFAULT_COLOR_PALETTE).toHaveLength(32);
    expect(new Set(DEFAULT_COLOR_PALETTE.map((color) => color.value)).size).toBe(32);
  });

  it('chooses readable text for every swatch', () => {
    for (const color of DEFAULT_COLOR_PALETTE) {
      const text = readableTextColor(color.value);
      expect(contrastBetween(color.value, text), color.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses light text over dark colors and dark text over light colors', () => {
    expect(readableTextColor('#1E3A8A')).toBe('#FFFFFF');
    expect(readableTextColor('#FACC15')).toBe('#111827');
  });

  it('applies the readable foreground to semantic text on a colored surface', () => {
    const style = coloredSurfaceStyle('#1E3A8A');

    expect(style?.backgroundColor).toBe('#1E3A8A');
    expect(style?.color).toBe('#FFFFFF');
    expect(style?.['--text-primary']).toBe('#FFFFFF');
    expect(style?.['--text-muted']).toBe('#FFFFFF');
  });
});
