/**
 * The pairs of tokens that end up on top of each other, and the ratio each has
 * to clear.
 *
 * Two thresholds are in play, and conflating them is how a design system ends
 * up either inaccessible or washed out. WCAG 1.4.3 asks 4.5:1 of body text.
 * WCAG 1.4.11 asks 3:1 of a graphic that carries meaning — a card spine, a map
 * pin, the current-time line, the edge of an input — because a shape is easier
 * to make out than a letterform.
 *
 * Every pair here is asserted in both themes by contrast-contract.test.ts and
 * shown with its measured ratio on the Storybook contrast page.
 */

export interface ContrastPair {
  foreground: string;
  background: string;
  /** 4.5 for text, 3 for a meaningful graphic. */
  minRatio: number;
  /** What is actually drawn this way. */
  usage: string;
}

const TEXT = 4.5;
const GRAPHIC = 3;

export const CONTRAST_CONTRACT: ContrastPair[] = [
  // Body text across the three surfaces it lands on.
  { foreground: 'text-primary', background: 'surface-page', minRatio: TEXT, usage: 'body text' },
  { foreground: 'text-primary', background: 'surface-card', minRatio: TEXT, usage: 'card text' },
  {
    foreground: 'text-primary',
    background: 'surface-raised',
    minRatio: TEXT,
    usage: 'popover and dialog text',
  },
  {
    foreground: 'text-secondary',
    background: 'surface-card',
    minRatio: TEXT,
    usage: 'supporting text on a card',
  },
  {
    foreground: 'text-secondary',
    background: 'surface-page',
    minRatio: TEXT,
    usage: 'supporting text on the page',
  },
  {
    foreground: 'text-muted',
    background: 'surface-card',
    minRatio: TEXT,
    usage: 'timestamps and counts',
  },
  { foreground: 'text-muted', background: 'surface-page', minRatio: TEXT, usage: 'column headers' },
  {
    foreground: 'text-inverse',
    background: 'surface-inverse',
    minRatio: TEXT,
    usage: 'tooltip and toast text',
  },

  // Status labels, which are words and so held to the text threshold.
  {
    foreground: 'status-booked-text',
    background: 'surface-card',
    minRatio: TEXT,
    usage: '"Booked" on a card',
  },
  {
    foreground: 'status-booked-text',
    background: 'status-booked-soft',
    minRatio: TEXT,
    usage: '"Booked" inside its chip',
  },
  {
    foreground: 'status-pending-text',
    background: 'surface-card',
    minRatio: TEXT,
    usage: '"In progress" on a card',
  },
  {
    foreground: 'status-pending-text',
    background: 'status-pending-soft',
    minRatio: TEXT,
    usage: '"In progress" inside its chip',
  },
  {
    foreground: 'status-idea-text',
    background: 'surface-card',
    minRatio: TEXT,
    usage: '"Idea" on a card',
  },
  {
    foreground: 'status-idea-text',
    background: 'status-idea-soft',
    minRatio: TEXT,
    usage: '"Idea" inside its chip',
  },

  // Status marks: the card spine and the map pin, which carry the same meaning
  // without words and so are held to the graphic threshold.
  {
    foreground: 'status-booked',
    background: 'surface-card',
    minRatio: GRAPHIC,
    usage: 'booked spine and pin',
  },
  {
    foreground: 'status-booked',
    background: 'surface-page',
    minRatio: GRAPHIC,
    usage: 'booked pin on the map',
  },
  {
    foreground: 'status-pending',
    background: 'surface-card',
    minRatio: GRAPHIC,
    usage: 'in-progress spine and pin',
  },
  {
    foreground: 'status-pending',
    background: 'surface-page',
    minRatio: GRAPHIC,
    usage: 'in-progress pin on the map',
  },
  {
    foreground: 'status-idea',
    background: 'surface-card',
    minRatio: GRAPHIC,
    usage: 'idea spine and pin',
  },
  {
    foreground: 'status-idea',
    background: 'surface-page',
    minRatio: GRAPHIC,
    usage: 'idea pin on the map',
  },

  // Accent and interaction.
  {
    foreground: 'accent-text',
    background: 'surface-card',
    minRatio: TEXT,
    usage: 'link and selected label',
  },
  {
    foreground: 'accent-text',
    background: 'accent-soft',
    minRatio: TEXT,
    usage: 'label on a selected row',
  },
  {
    foreground: 'accent-ink',
    background: 'accent',
    minRatio: TEXT,
    usage: 'label on a primary button',
  },
  {
    foreground: 'focus-ring',
    background: 'surface-page',
    minRatio: GRAPHIC,
    usage: 'keyboard focus ring',
  },
  {
    foreground: 'focus-ring',
    background: 'surface-card',
    minRatio: GRAPHIC,
    usage: 'focus ring on a card',
  },
  {
    foreground: 'border-input',
    background: 'surface-card',
    minRatio: GRAPHIC,
    usage: 'edge of a text field',
  },
  {
    foreground: 'border-input',
    background: 'surface-page',
    minRatio: GRAPHIC,
    usage: 'edge of a field on the page',
  },

  // The now line and today's marker: a 1px rule and a dot, so graphic.
  {
    foreground: 'accent-now',
    background: 'surface-card',
    minRatio: GRAPHIC,
    usage: 'current-time line',
  },
  {
    foreground: 'accent-now',
    background: 'surface-page',
    minRatio: GRAPHIC,
    usage: "today's marker",
  },
];
