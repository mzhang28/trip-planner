import type { Meta, StoryObj } from '@storybook/react-vite';
import { contrastBetween } from '../lib/color';
import primitivesCss from '../styles/primitives.css?raw';
import semanticCss from '../styles/semantic.css?raw';
import { CONTRAST_CONTRACT } from './contrast-contract';
import { resolveTokens, type ThemeName } from './parseTokens';

const meta: Meta = {
  title: 'Foundations/Contrast',
  parameters: {
    docs: {
      description: {
        component:
          'Measured contrast for every pair of tokens that lands on top of another. The same contract is asserted by contrast-contract.test.ts, so a pair that fails here fails the build.',
      },
    },
  },
};

export default meta;

function Row({ theme, pair }: { theme: ThemeName; pair: (typeof CONTRAST_CONTRACT)[number] }) {
  const { values } = resolveTokens(primitivesCss, semanticCss, theme);
  const fg = values.get(pair.foreground) ?? '';
  const bg = values.get(pair.background) ?? '';
  const ratio = contrastBetween(fg, bg);
  const passes = ratio !== null && Number(ratio.toFixed(2)) >= pair.minRatio;

  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-3">
        <div
          className="flex h-9 w-32 items-center justify-center rounded-sm border border-line-default text-xs font-medium"
          style={{ background: bg, color: fg }}
        >
          {pair.minRatio === 4.5 ? 'Sample' : '▬▬▬'}
        </div>
      </td>
      <td className="py-2 pr-3">
        <div className="font-mono text-2xs text-ink">--{pair.foreground}</div>
        <div className="font-mono text-2xs text-ink-muted">on --{pair.background}</div>
      </td>
      <td className="py-2 pr-3 text-xs text-ink-secondary">{pair.usage}</td>
      <td className="py-2 pr-3 text-right">
        <span className="tabular text-sm text-ink">{ratio?.toFixed(2) ?? '—'}</span>
        <span className="ml-1 text-2xs text-ink-muted">/ {pair.minRatio}</span>
      </td>
      <td className="py-2 text-right">
        <span
          className={
            passes
              ? 'rounded-sm bg-booked-soft px-1.5 py-0.5 text-2xs font-medium text-booked-text'
              : 'rounded-sm bg-danger-soft px-1.5 py-0.5 text-2xs font-medium text-danger'
          }
        >
          {passes ? 'Pass' : 'Fail'}
        </span>
      </td>
    </tr>
  );
}

function Table({ theme }: { theme: ThemeName }) {
  const text = CONTRAST_CONTRACT.filter((p) => p.minRatio === 4.5);
  const graphic = CONTRAST_CONTRACT.filter((p) => p.minRatio === 3);

  return (
    <div className="max-w-4xl">
      <h3 className="mb-1 text-sm text-ink">Words — 4.5:1</h3>
      <p className="mb-3 text-sm text-ink-secondary">
        Anything a person reads as text, down to the smallest label.
      </p>
      <table className="mb-10 w-full text-left">
        <tbody>
          {text.map((pair) => (
            <Row key={`${pair.foreground}-${pair.background}`} theme={theme} pair={pair} />
          ))}
        </tbody>
      </table>

      <h3 className="mb-1 text-sm text-ink">Marks — 3:1</h3>
      <p className="mb-3 text-sm text-ink-secondary">
        A shape that carries meaning without words: a card spine, a map pin, the current-time line,
        the edge of a field. A shape is easier to make out than a letterform, so the threshold is
        lower — but it is still a threshold.
      </p>
      <table className="w-full text-left">
        <tbody>
          {graphic.map((pair) => (
            <Row key={`${pair.foreground}-${pair.background}`} theme={theme} pair={pair} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Light: StoryObj = { render: () => <Table theme="light" /> };
export const Dark: StoryObj = {
  render: () => <Table theme="dark" />,
  globals: { theme: 'dark' },
};
