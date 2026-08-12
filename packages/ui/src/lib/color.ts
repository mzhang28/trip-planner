import type { CSSProperties } from 'react';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * A deliberately broad set of hues and lightnesses for user-assigned labels.
 *
 * These are data colours, not theme colours: a saved choice must keep looking
 * the same when the app theme changes. Names make the swatches understandable
 * to screen-reader users, for whom a bare hex value is not a useful label.
 */
const BOLD_COLOR_PALETTE = [
  { name: 'Ruby', value: '#B91C1C' },
  { name: 'Tangerine', value: '#EA580C' },
  { name: 'Gold', value: '#CA8A04' },
  { name: 'Lime', value: '#4D7C0F' },
  { name: 'Emerald', value: '#15803D' },
  { name: 'Teal', value: '#0F766E' },
  { name: 'Ocean', value: '#0369A1' },
  { name: 'Blue', value: '#1D4ED8' },
  { name: 'Indigo', value: '#4338CA' },
  { name: 'Violet', value: '#7E22CE' },
  { name: 'Fuchsia', value: '#A21CAF' },
  { name: 'Raspberry', value: '#BE185D' },
  { name: 'Coral', value: '#F87171' },
  { name: 'Apricot', value: '#FB923C' },
  { name: 'Sunflower', value: '#FACC15' },
  { name: 'Chartreuse', value: '#A3E635' },
  { name: 'Mint', value: '#4ADE80' },
  { name: 'Aquamarine', value: '#2DD4BF' },
  { name: 'Sky', value: '#38BDF8' },
  { name: 'Cornflower', value: '#60A5FA' },
  { name: 'Periwinkle', value: '#818CF8' },
  { name: 'Lavender', value: '#C084FC' },
  { name: 'Orchid', value: '#E879F9' },
  { name: 'Rose', value: '#F472B6' },
  { name: 'Brick', value: '#7C2D12' },
  { name: 'Ochre', value: '#92400E' },
  { name: 'Olive', value: '#3F6212' },
  { name: 'Forest', value: '#166534' },
  { name: 'Deep sea', value: '#164E63' },
  { name: 'Navy', value: '#1E3A8A' },
  { name: 'Plum', value: '#581C87' },
  { name: 'Wine', value: '#831843' },
] as const;

export type DefaultColor = (typeof BOLD_COLOR_PALETTE)[number]['value'];

const PASTEL_WHITE_MIX = 0.82;

/** Makes the fixed palette's muted partner without weakening its bold identity colour. */
function pastelHex(value: string): string {
  const numeric = Number.parseInt(value.slice(1), 16);
  const channel = (shift: number) => (numeric >> shift) & 0xff;
  const pastel = (component: number) =>
    Math.round(component + (255 - component) * PASTEL_WHITE_MIX);
  const hex = (component: number) => pastel(component).toString(16).padStart(2, '0');
  return `#${hex(channel(16))}${hex(channel(8))}${hex(channel(0))}`.toUpperCase();
}

/**
 * Each choice has one bold value for accents and one muted value for surfaces.
 * `value` remains an alias for `bold` so saved documents and callers written
 * before the two-variant palette continue to store the same colour.
 */
export const DEFAULT_COLOR_PALETTE = BOLD_COLOR_PALETTE.map((color) => ({
  ...color,
  bold: color.value,
  muted: pastelHex(color.value),
}));

const PALETTE_BY_VARIANT = new Map<string, (typeof DEFAULT_COLOR_PALETTE)[number]>();
for (const color of DEFAULT_COLOR_PALETTE) {
  PALETTE_BY_VARIANT.set(color.bold.toUpperCase(), color);
  PALETTE_BY_VARIANT.set(color.muted.toUpperCase(), color);
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

/** The strong palette variant for borders, markers, and other small accents. */
export function boldColor(value: string | undefined): string | undefined {
  if (!value || !parseColor(value)) return undefined;
  return PALETTE_BY_VARIANT.get(value.trim().toUpperCase())?.bold ?? value;
}

/** The pastel palette variant used when colour occupies a surface. */
export function mutedColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = parseColor(value);
  if (!parsed) return undefined;

  const paletteColor = PALETTE_BY_VARIANT.get(value.trim().toUpperCase());
  if (paletteColor) return paletteColor.muted;

  const pastel = (component: number) =>
    Math.round(component + (255 - component) * PASTEL_WHITE_MIX);
  return `rgb(${pastel(parsed.r)}, ${pastel(parsed.g)}, ${pastel(parsed.b)})`;
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

/** Picks whichever neutral has the stronger WCAG contrast with a background. */
export function readableTextColor(background: string, dark = '#111827', light = '#FFFFFF'): string {
  const bg = parseColor(background);
  const darkText = parseColor(dark);
  const lightText = parseColor(light);

  if (!bg || !darkText || !lightText) return dark;
  return contrastRatio(bg, lightText) > contrastRatio(bg, darkText) ? light : dark;
}

/**
 * Makes semantic text utilities inherit a readable foreground on a custom
 * background. Keeping this in one place prevents calendar views from each
 * making a different dark-colour decision.
 */
export function coloredSurfaceStyle(color: string | undefined):
  | (CSSProperties & {
      '--text-primary': string;
      '--text-secondary': string;
      '--text-muted': string;
      '--text-placeholder': string;
      '--surface-sunken': string;
    })
  | undefined {
  const background = mutedColor(color);
  const border = boldColor(color);
  if (!background || !border) return undefined;
  const foreground = readableTextColor(background);

  return {
    backgroundColor: background,
    borderColor: border,
    color: foreground,
    '--text-primary': foreground,
    '--text-secondary': foreground,
    '--text-muted': foreground,
    '--text-placeholder': foreground,
    '--surface-sunken': `color-mix(in srgb, ${background}, ${foreground} 10%)`,
  };
}
