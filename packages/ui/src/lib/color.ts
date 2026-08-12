import type { CSSProperties } from 'react';

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

/** Makes the light theme's muted partner without weakening its bold identity colour. */
function pastelHex(value: string): string {
  const numeric = Number.parseInt(value.slice(1), 16);
  const channel = (shift: number) => (numeric >> shift) & 0xff;
  const pastel = (component: number) =>
    Math.round(component + (255 - component) * PASTEL_WHITE_MIX);
  const hex = (component: number) => pastel(component).toString(16).padStart(2, '0');
  return `#${hex(channel(16))}${hex(channel(8))}${hex(channel(0))}`.toUpperCase();
}

/*
 * The dark theme needs its own pair of variants.
 *
 * A pastel is a colour mixed most of the way to white, so on the dark theme's
 * near-black surfaces it glows instead of tinting, and the darkest bold values
 * -- Navy, Wine, Brick -- disappear into the surface they are drawn on. Both
 * variants are therefore derived twice, once per theme.
 *
 * The dark values are computed from the same 32 bold hexes rather than picked by
 * hand, so the light and dark palettes cannot drift apart when a colour is
 * added. Each derivation keeps the hue and moves the lightness until the result
 * hits a luminance the theme can work with.
 */

/** White text clears 4.5:1 on any surface at or below this luminance. */
const DARK_SURFACE_MIN_LUMINANCE = 0.05;
const DARK_SURFACE_MAX_LUMINANCE = 0.13;

/**
 * How the palette's lightness order is spread across that band. Below 1 it
 * gives the dark half of the palette more of the band than its luminances
 * would, which is what keeps Navy apart from Blue and Wine apart from
 * Raspberry: those pairs differ mostly in lightness, and squeezing them into
 * one dark step would leave the dark theme with fewer usable colours than the
 * light one.
 */
const DARK_SURFACE_ORDER_CURVE = 0.55;

/** Dark surfaces sit slightly off full chroma, the way the pastels do. */
const DARK_SURFACE_SATURATION = 0.75;

/*
 * An accent has to be light on a dark theme. The floor is where #111827 clears
 * 4.5:1, which is what a map pin needs from the number written on it; the base
 * and slope lift the dark half of the palette to roughly the lightness the
 * light half already has, and leave anything already lighter alone.
 */
const DARK_ACCENT_MIN_LUMINANCE = 0.24;
const DARK_ACCENT_BASE_LIGHTNESS = 0.5;
const DARK_ACCENT_LIGHTNESS_SLOPE = 0.35;

interface Hsl {
  /** Turns, not degrees: 0 to 1 around the wheel. */
  h: number;
  s: number;
  l: number;
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const [red, green, blue] = [r / 255, g / 255, b / 255] as const;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const range = max - min;
  const s = l > 0.5 ? range / (2 - max - min) : range / (max + min);
  const h =
    max === red
      ? ((green - blue) / range + (green < blue ? 6 : 0)) / 6
      : max === green
        ? ((blue - red) / range + 2) / 6
        : ((red - green) / range + 4) / 6;
  return { h, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };

  const high = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const low = 2 * l - high;
  const channel = (position: number) => {
    const turn = position < 0 ? position + 1 : position > 1 ? position - 1 : position;
    if (turn < 1 / 6) return low + (high - low) * 6 * turn;
    if (turn < 1 / 2) return high;
    if (turn < 2 / 3) return low + (high - low) * (2 / 3 - turn) * 6;
    return low;
  };
  return {
    r: channel(h + 1 / 3) * 255,
    g: channel(h) * 255,
    b: channel(h - 1 / 3) * 255,
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (component: number) =>
    Math.round(Math.min(255, Math.max(0, component)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/**
 * The same hue at a chosen relative luminance.
 *
 * Lightness is searched rather than calculated because luminance is weighted by
 * channel: a yellow and a blue at the same HSL lightness are nowhere near the
 * same brightness, and it is brightness that contrast is measured on. Raising
 * lightness only ever raises luminance, so a bisection lands on the answer.
 */
function atLuminance(rgb: Rgb, target: number, saturationScale = 1): Rgb {
  const { h, s } = toHsl(rgb);
  const saturation = s * saturationScale;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step++) {
    const middle = (low + high) / 2;
    if (relativeLuminance(fromHsl({ h, s: saturation, l: middle })) < target) low = middle;
    else high = middle;
  }
  return fromHsl({ h, s: saturation, l: (low + high) / 2 });
}

/** The brightest bold value, which anchors the top of the dark surface band. */
const BRIGHTEST_BOLD_LUMINANCE = Math.max(
  ...BOLD_COLOR_PALETTE.map((color) => relativeLuminance(parseColor(color.value)!)),
);

/** The dark theme's surface variant: the hue as a tint, dark enough for white text. */
function darkSurfaceHex(bold: Rgb): string {
  const place = Math.min(1, relativeLuminance(bold) / BRIGHTEST_BOLD_LUMINANCE);
  const target =
    DARK_SURFACE_MIN_LUMINANCE +
    (DARK_SURFACE_MAX_LUMINANCE - DARK_SURFACE_MIN_LUMINANCE) *
      Math.pow(place, DARK_SURFACE_ORDER_CURVE);
  return toHex(atLuminance(bold, target, DARK_SURFACE_SATURATION));
}

/** The dark theme's accent variant: the hue lifted until it reads on a dark surface. */
function darkAccentHex(bold: Rgb): string {
  const { h, s, l } = toHsl(bold);
  const lifted = fromHsl({
    h,
    s,
    l: Math.min(1, Math.max(l, DARK_ACCENT_BASE_LIGHTNESS + DARK_ACCENT_LIGHTNESS_SLOPE * l)),
  });
  return relativeLuminance(lifted) >= DARK_ACCENT_MIN_LUMINANCE
    ? toHex(lifted)
    : toHex(atLuminance(lifted, DARK_ACCENT_MIN_LUMINANCE));
}

/**
 * Each choice has an accent value for borders and markers and a surface value
 * for the background under text, in each of the two themes. `value` remains an
 * alias for `bold` so saved documents and callers written before the palette
 * grew variants continue to store the same colour.
 */
export const DEFAULT_COLOR_PALETTE = BOLD_COLOR_PALETTE.map((color) => {
  const rgb = parseColor(color.value)!;
  return {
    ...color,
    bold: color.value,
    muted: pastelHex(color.value),
    boldDark: darkAccentHex(rgb),
    mutedDark: darkSurfaceHex(rgb),
  };
});

/*
 * Any variant resolves back to the choice it belongs to, so a document that
 * stored a surface value still gets the accent asked for.
 */
const PALETTE_BY_VARIANT = new Map<string, (typeof DEFAULT_COLOR_PALETTE)[number]>();
for (const color of DEFAULT_COLOR_PALETTE) {
  for (const variant of [color.bold, color.muted, color.boldDark, color.mutedDark]) {
    PALETTE_BY_VARIANT.set(variant.toUpperCase(), color);
  }
}

export interface ThemeVariants {
  light: string;
  dark: string;
}

/**
 * Writes a light and a dark value as one CSS value.
 *
 * `light-dark()` picks between them using the element's `color-scheme`, which
 * both theme blocks in semantic.css declare. That is what lets these functions
 * stay pure: a saved colour becomes one string that is right in either theme, so
 * no caller has to know which theme is on. Storybook shows both themes on one
 * screen, where a value chosen in JavaScript could only ever be right in one of
 * the two panes.
 */
function themed({ light, dark }: ThemeVariants): string {
  return `light-dark(${light}, ${dark})`;
}

/** The accent variant, per theme, for borders, markers, and other small marks. */
export function boldVariants(value: string | undefined): ThemeVariants | undefined {
  if (!value) return undefined;
  const parsed = parseColor(value);
  if (!parsed) return undefined;

  const paletteColor = PALETTE_BY_VARIANT.get(value.trim().toUpperCase());
  if (paletteColor) return { light: paletteColor.bold, dark: paletteColor.boldDark };
  return { light: value, dark: darkAccentHex(parsed) };
}

/** The surface variant, per theme, for when colour sits under text. */
export function mutedVariants(value: string | undefined): ThemeVariants | undefined {
  if (!value) return undefined;
  const parsed = parseColor(value);
  if (!parsed) return undefined;

  const paletteColor = PALETTE_BY_VARIANT.get(value.trim().toUpperCase());
  if (paletteColor) return { light: paletteColor.muted, dark: paletteColor.mutedDark };

  const pastel = (component: number) =>
    Math.round(component + (255 - component) * PASTEL_WHITE_MIX);
  return {
    light: toHex({ r: pastel(parsed.r), g: pastel(parsed.g), b: pastel(parsed.b) }),
    dark: darkSurfaceHex(parsed),
  };
}

/** The strong palette variant for borders, markers, and other small accents. */
export function boldColor(value: string | undefined): string | undefined {
  const variants = boldVariants(value);
  return variants && themed(variants);
}

/** The palette variant used when colour occupies a surface. */
export function mutedColor(value: string | undefined): string | undefined {
  const variants = mutedVariants(value);
  return variants && themed(variants);
}

/** The ink that stays readable on top of the bold variant, in either theme. */
export function boldInkColor(value: string | undefined): string | undefined {
  const variants = boldVariants(value);
  if (!variants) return undefined;
  return themed({
    light: readableTextColor(variants.light),
    dark: readableTextColor(variants.dark),
  });
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
 * making a different decision about what is readable on a colour, and it is
 * where the surface, its border, and its text all agree on a theme.
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
  const background = mutedVariants(color);
  const border = boldVariants(color);
  if (!background || !border) return undefined;

  const ink = {
    light: readableTextColor(background.light),
    dark: readableTextColor(background.dark),
  };
  const foreground = themed(ink);

  return {
    backgroundColor: themed(background),
    borderColor: themed(border),
    color: foreground,
    '--text-primary': foreground,
    '--text-secondary': foreground,
    '--text-muted': foreground,
    '--text-placeholder': foreground,
    /*
     * Mixed per theme rather than around the pair: light-dark() belongs at the
     * top of a colour value, not inside another colour function's arguments.
     */
    '--surface-sunken': themed({
      light: `color-mix(in srgb, ${background.light}, ${ink.light} 10%)`,
      dark: `color-mix(in srgb, ${background.dark}, ${ink.dark} 10%)`,
    }),
  };
}
