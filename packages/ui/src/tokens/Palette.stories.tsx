import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorPicker } from '../components/ColorPicker';
import {
  DEFAULT_COLOR_PALETTE,
  boldColor,
  coloredSurfaceStyle,
  contrastBetween,
  mutedColor,
  readableTextColor,
} from '../lib/color';

const meta: Meta = {
  title: 'Foundations/Palette',
  parameters: {
    docs: {
      description: {
        component:
          'The 32 colours a person can assign to an event, a city, or a custom field. Each one has an accent variant for borders and markers and a surface variant for the background under text, in each theme: a pastel that works on white is a lamp on a near-black page, and the darkest accents vanish there. A stored colour is one of the 32 accent hexes, so a document keeps its colour when the theme changes.',
      },
    },
  },
};

export default meta;

/** One colour, drawn the way the app draws it: a surface with its accent as the border. */
function Swatch({ color }: { color: (typeof DEFAULT_COLOR_PALETTE)[number] }) {
  return (
    <div
      className="rounded-sm border px-2 py-1.5 text-2xs"
      style={coloredSurfaceStyle(color.bold)}
      data-testid="palette-swatch"
    >
      <div className="font-medium">{color.name}</div>
      <div className="tabular opacity-80">{color.bold}</div>
    </div>
  );
}

function Grid() {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {DEFAULT_COLOR_PALETTE.map((color) => (
        <Swatch key={color.bold} color={color} />
      ))}
    </div>
  );
}

/**
 * Every swatch, in both themes at once. This is the page that says whether the
 * two derivations agree: the same 32 names should be as easy to tell apart on
 * the right as on the left.
 */
export const Colors: StoryObj = {
  render: () => <Grid />,
  globals: { theme: 'both' },
};

/**
 * The same colours as a calendar draws them, so a card can be checked against
 * the grid it sits on rather than against the page.
 */
export const OnTheWeekGrid: StoryObj = {
  name: 'On the week grid',
  globals: { theme: 'both' },
  render: () => (
    <div className="grid gap-px bg-line" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      {DEFAULT_COLOR_PALETTE.slice(0, 16).map((color) => (
        <div key={color.bold} className="flex flex-col gap-1 bg-page p-1">
          <div
            className="rounded-sm border px-1 py-1 text-2xs"
            style={coloredSurfaceStyle(color.bold)}
          >
            <div className="tabular opacity-80">09:30</div>
            <div>{color.name}</div>
          </div>
          {/* An event with no colour of its own, which is the card surface. */}
          <div className="rounded-sm border border-line bg-card px-1 py-1 text-2xs text-ink">
            <div className="tabular text-ink-muted">11:00</div>
            <div>No colour</div>
          </div>
        </div>
      ))}
    </div>
  ),
};

/** The measured numbers behind the swatches above. */
export const Contrast: StoryObj = {
  render: () => {
    const rows = DEFAULT_COLOR_PALETTE.map((color) => {
      const lightInk = readableTextColor(color.muted);
      const darkInk = readableTextColor(color.mutedDark);
      return {
        name: color.name,
        light: contrastBetween(color.muted, lightInk),
        dark: contrastBetween(color.mutedDark, darkInk),
        // The border of a card, which owes 3:1 against the sheet behind it.
        lightEdge: contrastBetween(color.bold, '#E7EAEE'),
        darkEdge: contrastBetween(color.boldDark, '#1A2029'),
      };
    });

    const cell = (value: number | null, minRatio: number) => (
      <td className="py-1.5 pr-3 text-right">
        <span className="tabular text-xs text-ink">{value?.toFixed(2) ?? '—'}</span>
        <span className="ml-1 text-2xs text-ink-muted">/ {minRatio}</span>
      </td>
    );

    return (
      <table className="w-full max-w-2xl text-left">
        <thead>
          <tr className="text-2xs text-ink-muted uppercase">
            <th className="py-1.5 font-medium">Colour</th>
            <th className="py-1.5 text-right font-medium">Text, light</th>
            <th className="py-1.5 text-right font-medium">Text, dark</th>
            <th className="py-1.5 text-right font-medium">Edge, light</th>
            <th className="py-1.5 text-right font-medium">Edge, dark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-line">
              <td className="py-1.5 pr-3 text-xs text-ink">{row.name}</td>
              {cell(row.light, 4.5)}
              {cell(row.dark, 4.5)}
              {cell(row.lightEdge, 3)}
              {cell(row.darkEdge, 3)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
};

/** The control that assigns one, with a colour already chosen. */
export const Picker: StoryObj = {
  globals: { theme: 'both' },
  render: () => (
    <div className="flex items-center gap-3">
      <ColorPicker value={undefined} onChange={() => {}} label="Event colour" />
      <ColorPicker value="#1E3A8A" onChange={() => {}} label="Event colour" />
      <ColorPicker value="#FACC15" onChange={() => {}} label="Event colour" />
      <ColorPicker value="#1E3A8A" onChange={() => {}} label="Event colour" isDisabled />
    </div>
  ),
};

/** What one colour resolves to, for reading the two variants against each other. */
export const Variants: StoryObj = {
  globals: { theme: 'both' },
  render: () => (
    <div className="flex flex-col gap-2">
      {['#1E3A8A', '#831843', '#FACC15', '#2DD4BF'].map((stored) => (
        <div key={stored} className="flex items-center gap-2">
          <span
            className="size-8 rounded-sm border-2"
            style={{ background: mutedColor(stored), borderColor: boldColor(stored) }}
          />
          <span className="tabular text-2xs text-ink-muted">{stored}</span>
        </div>
      ))}
    </div>
  ),
};
