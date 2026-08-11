export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

/** Returns null for anything that is not an opaque colour, such as a scrim. */
export function parseColor(value: string): Rgb | null {
  const input = value.trim();

  const short = HEX_SHORT.exec(input);
  if (short) {
    return {
      r: parseInt(short[1]! + short[1]!, 16),
      g: parseInt(short[2]! + short[2]!, 16),
      b: parseInt(short[3]! + short[3]!, 16),
    };
  }

  const long = HEX_LONG.exec(input);
  if (long) {
    return {
      r: parseInt(long[1]!, 16),
      g: parseInt(long[2]!, 16),
      b: parseInt(long[3]!, 16),
    };
  }

  const fn = RGB_FN.exec(input);
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]) };
  }

  return null;
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.1 contrast ratio, between 1 and 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastBetween(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  return contrastRatio(ca, cb);
}
