import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR_PALETTE,
  boldColor,
  coloredSurfaceStyle,
  contrastBetween,
  mutedColor,
  readableTextColor,
} from './color';

describe('default color palette', () => {
  it('contains 32 distinct bold and muted pairs', () => {
    expect(DEFAULT_COLOR_PALETTE).toHaveLength(32);
    expect(new Set(DEFAULT_COLOR_PALETTE.map((color) => color.bold)).size).toBe(32);
    expect(new Set(DEFAULT_COLOR_PALETTE.map((color) => color.muted)).size).toBe(32);

    for (const color of DEFAULT_COLOR_PALETTE) {
      expect(color.value).toBe(color.bold);
      expect(color.muted).not.toBe(color.bold);
    }
  });

  it('chooses readable text for every swatch', () => {
    for (const color of DEFAULT_COLOR_PALETTE) {
      const boldText = readableTextColor(color.bold);
      const mutedText = readableTextColor(color.muted);
      expect(contrastBetween(color.bold, boldText), `${color.name} bold`).toBeGreaterThanOrEqual(4.5);
      expect(contrastBetween(color.muted, mutedText), `${color.name} muted`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('resolves either member of a pair to the requested variant', () => {
    const navy = DEFAULT_COLOR_PALETTE.find((color) => color.name === 'Navy')!;

    expect(boldColor(navy.muted)).toBe(navy.bold);
    expect(mutedColor(navy.bold)).toBe(navy.muted);
  });

  it('uses light text over dark colors and dark text over light colors', () => {
    expect(readableTextColor('#1E3A8A')).toBe('#FFFFFF');
    expect(readableTextColor('#FACC15')).toBe('#111827');
  });

  it('applies the readable foreground to semantic text on a colored surface', () => {
    const style = coloredSurfaceStyle('#1E3A8A');

    expect(style?.backgroundColor).toBe('#D7DCEA');
    expect(style?.borderColor).toBe('#1E3A8A');
    expect(style?.color).toBe('#111827');
    expect(style?.['--text-primary']).toBe('#111827');
    expect(style?.['--text-muted']).toBe('#111827');
  });
});
