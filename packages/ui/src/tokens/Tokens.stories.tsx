import type { Meta, StoryObj } from '@storybook/react-vite';
import primitivesCss from '../styles/primitives.css?raw';
import semanticCss from '../styles/semantic.css?raw';
import { resolveTokens, type ThemeName } from './parseTokens';

const meta: Meta = {
  title: 'Foundations/Tokens',
  parameters: {
    docs: {
      description: {
        component:
          'Every token, read out of the stylesheets the browser loads. Nothing here is a second copy of the palette, so this page cannot drift from what ships.',
      },
    },
  },
};

export default meta;

function useResolved(theme: ThemeName) {
  return resolveTokens(primitivesCss, semanticCss, theme);
}

function Swatch({ name, theme }: { name: string; theme: ThemeName }) {
  const { values, references } = useResolved(theme);
  const value = values.get(name) ?? '—';
  const reference = references.get(name) ?? '';
  const pointsAt = reference.startsWith('var(') ? reference.replace(/var\(|\)/g, '') : null;

  return (
    <div className="flex items-center gap-3">
      <div
        className="size-10 shrink-0 rounded-md border border-line-default"
        style={{ background: value }}
      />
      <div className="min-w-0">
        <div className="truncate font-mono text-xs text-ink">--{name}</div>
        <div className="truncate text-2xs text-ink-muted">
          {pointsAt ? `${pointsAt} · ${value}` : value}
        </div>
      </div>
    </div>
  );
}

function Group({ title, names, theme }: { title: string; names: string[]; theme: ThemeName }) {
  return (
    <section className="mb-8">
      <h3 className="mb-3 text-sm text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {names.map((name) => (
          <Swatch key={name} name={name} theme={theme} />
        ))}
      </div>
    </section>
  );
}

const SEMANTIC_GROUPS: Array<{ title: string; names: string[] }> = [
  {
    title: 'Surfaces',
    names: [
      'surface-page',
      'surface-card',
      'surface-raised',
      'surface-sunken',
      'surface-inverse',
    ],
  },
  {
    title: 'Text',
    names: ['text-primary', 'text-secondary', 'text-muted', 'text-placeholder', 'text-inverse'],
  },
  {
    title: 'Borders',
    names: ['border-subtle', 'border-default', 'border-strong', 'border-input'],
  },
  {
    title: 'Booking status',
    names: [
      'status-booked',
      'status-booked-text',
      'status-booked-soft',
      'status-idea',
      'status-idea-text',
      'status-idea-soft',
    ],
  },
  {
    title: 'Attention and offline state',
    names: ['status-pending', 'status-pending-text', 'status-pending-soft'],
  },
  {
    title: 'Accent and interaction',
    names: ['accent', 'accent-text', 'accent-hover', 'accent-soft', 'accent-ink', 'focus-ring'],
  },
  {
    title: 'Now and destructive',
    names: ['accent-now', 'accent-now-soft', 'danger', 'danger-hover', 'danger-ink', 'danger-soft'],
  },
];

/** The roles components reference. These are the only colours in app code. */
export const Semantic: StoryObj = {
  render: (_args, { globals }) => {
    const theme: ThemeName = globals.theme === 'dark' ? 'dark' : 'light';
    return (
      <div className="max-w-5xl">
        <p className="mb-6 max-w-2xl text-sm text-ink-secondary">
          A component only ever names a token from this page. Each swatch shows which step of a
          primitive ramp the role currently points at, so a change here is traceable to a change
          there.
        </p>
        {SEMANTIC_GROUPS.map((group) => (
          <Group key={group.title} title={group.title} names={group.names} theme={theme} />
        ))}
      </div>
    );
  },
};

const RAMPS = ['grey', 'green', 'amber', 'vermilion', 'indigo'];

/** The raw ramps. App code never names these. */
export const Primitives: StoryObj = {
  render: (_args, { globals }) => {
    const theme: ThemeName = globals.theme === 'dark' ? 'dark' : 'light';
    const { values } = useResolved(theme);

    return (
      <div className="max-w-5xl">
        <p className="mb-6 max-w-2xl text-sm text-ink-secondary">
          The vocabulary the semantic layer draws from. These do not change between themes — the
          two themes pick different steps of the same ramps.
        </p>
        {RAMPS.map((ramp) => {
          const steps = [...values.keys()]
            .filter((name) => new RegExp(`^${ramp}-\\d+$`).test(name))
            .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));

          return (
            <section key={ramp} className="mb-6">
              <h3 className="mb-2 text-sm text-ink capitalize">{ramp}</h3>
              <div className="flex flex-wrap gap-2">
                {steps.map((name) => (
                  <div key={name} className="w-20">
                    <div
                      className="h-12 rounded-md border border-line-default"
                      style={{ background: values.get(name) }}
                    />
                    <div className="mt-1 font-mono text-2xs text-ink-muted">
                      {name.split('-')[1]}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  },
};

/*
 * Written out rather than built with a template string. Tailwind finds classes
 * by scanning the source for literals, so `text-${step}` produces nothing.
 */
const TYPE_CLASS = {
  '4xl': 'text-4xl',
  '3xl': 'text-3xl',
  '2xl': 'text-2xl',
  xl: 'text-xl',
  lg: 'text-lg',
  base: 'text-base',
  sm: 'text-sm',
  xs: 'text-xs',
  '2xs': 'text-2xs',
} as const;

type TypeStep = keyof typeof TYPE_CLASS;

const DISPLAY_STEPS: TypeStep[] = ['4xl', '3xl', '2xl', 'xl'];
const BODY_STEPS: TypeStep[] = ['4xl', '3xl', '2xl', 'xl', 'lg', 'base', 'sm', 'xs', '2xs'];

export const Typography: StoryObj = {
  render: () => (
    <div className="max-w-3xl">
      <section className="mb-10">
        <h3 className="mb-4 text-sm text-ink">Display — Archivo, width axis at 112%</h3>
        <div className="space-y-2">
          {DISPLAY_STEPS.map((step) => (
            <div key={step} className="flex items-baseline gap-4">
              <span className="w-10 shrink-0 font-mono text-2xs text-ink-muted">{step}</span>
              <span
                className={`font-display font-semibold ${TYPE_CLASS[step]}`}
                style={{ fontStretch: '112%' }}
              >
                Kyoto to Osaka
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-4 text-sm text-ink">Body — IBM Plex Sans</h3>
        <div className="space-y-2">
          {BODY_STEPS.map((step) => (
            <div key={step} className="flex items-baseline gap-4">
              <span className="w-10 shrink-0 font-mono text-2xs text-ink-muted">{step}</span>
              <span className={TYPE_CLASS[step]}>
                Check in at the ryokan before six, they lock the door
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm text-ink">Tabular — IBM Plex Mono</h3>
        <p className="mb-3 max-w-xl text-sm text-ink-secondary">
          Times, dates, airport codes, flight numbers, and confirmation codes. Figures are the same
          width, so a column of times lines up on the digit rather than drifting.
        </p>
        <div className="tabular space-y-1 text-sm">
          <div>09:00 – 11:30 · NRT → ITM · NH 017</div>
          <div>14:15 – 15:05 · HND → CTS · JL 505</div>
          <div>18:40 – 19:55 · KIX → FUK · MM 141</div>
        </div>
      </section>
    </div>
  ),
};

const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

export const SpacingAndShape: StoryObj = {
  render: () => (
    <div className="max-w-3xl">
      <section className="mb-10">
        <h3 className="mb-1 text-sm text-ink">Spacing</h3>
        <p className="mb-4 text-sm text-ink-secondary">
          A 4px base. Every gap and inset is a multiple of it.
        </p>
        <div className="space-y-1.5">
          {SPACE_STEPS.map((step) => (
            <div key={step} className="flex items-center gap-3">
              <span className="w-8 shrink-0 font-mono text-2xs text-ink-muted">{step}</span>
              <div className="h-3 bg-accent" style={{ width: `calc(var(--spacing) * ${step})` }} />
              <span className="font-mono text-2xs text-ink-muted">{step * 4}px</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-1 text-sm text-ink">Radii</h3>
        <p className="mb-4 text-sm text-ink-secondary">
          Small by default. This is printed matter, not rounded app chrome.
        </p>
        <div className="flex flex-wrap gap-4">
          {(['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((step) => (
            <div key={step}>
              <div
                className="size-16 border border-line-default bg-card"
                style={{ borderRadius: `var(--radius-${step})` }}
              />
              <div className="mt-1 font-mono text-2xs text-ink-muted">{step}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm text-ink">Elevation</h3>
        <p className="mb-4 text-sm text-ink-secondary">
          Shallow, and almost absent in the dark theme where a shadow reads as dirt. Depth there
          comes from the surface ramp instead. Only the drag lift stays loud.
        </p>
        <div className="flex flex-wrap gap-5">
          {(['xs', 'sm', 'md', 'lg', 'drag'] as const).map((step) => (
            <div key={step}>
              <div
                className="size-20 rounded-lg bg-card"
                style={{ boxShadow: `var(--depth-${step})` }}
              />
              <div className="mt-2 font-mono text-2xs text-ink-muted">{step}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};
