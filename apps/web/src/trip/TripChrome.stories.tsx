import type { Meta, StoryObj } from '@storybook/react-vite';
import { withRouter } from '../stories/harness';
import { TripChrome } from './TripChrome';

/**
 * The frame a trip sits in: the four places it can be, and the trip's name.
 *
 * The rail collapses to icons and remembers that it did, because it is a
 * four-item menu that would otherwise take a fifth of a laptop screen for the
 * whole trip. The document itself never scrolls — every route scrolls inside
 * this frame, so a long itinerary cannot carry the navigation off the top.
 */
const meta = {
  title: 'App/Trip chrome',
  decorators: [withRouter],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Page() {
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-6">
      <h1 className="text-xl font-semibold text-ink">Whatever route is open</h1>
      <p className="max-w-prose text-sm text-ink-secondary">
        The itinerary, the to-do list, the file library, or the settings. The frame is the same for
        all four, and only this part changes.
      </p>
    </div>
  );
}

export const Sidebar: Story = {
  render: () => (
    <div className="h-[520px]">
      <TripChrome tripId="t_japan" tripName="japan 2026!">
        <Page />
      </TripChrome>
    </div>
  ),
};

/**
 * Narrow, where the rail is not shown at all and the same four places live
 * along the bottom.
 */
export const OnAPhone: Story = {
  render: () => (
    <div className="h-[560px] w-[380px] overflow-hidden rounded-lg border border-line">
      <TripChrome tripId="t_japan" tripName="japan 2026!">
        <Page />
      </TripChrome>
    </div>
  ),
};
