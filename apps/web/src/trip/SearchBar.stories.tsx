import type { Meta, StoryObj } from '@storybook/react-vite';
import { HOME_TIMEZONE, japanTrip } from '../stories/japan';
import { SearchBar } from './SearchBar';

/**
 * One field over the whole trip: events, days, and the handful of things the
 * app can do.
 *
 * Type `inari` for an idea nobody has dated, `nrt` for a flight by its airport
 * code, or `oops` for the confirmation code somebody fat-fingered into a hotel
 * booking — confirmation codes are searchable precisely because that is what
 * you have in front of you when you need the event.
 */
const meta = {
  title: 'Itinerary/Search',
  parameters: {
    docs: {
      description: {
        component:
          'Results are grouped by what they are, so a day and an event with similar names do not sit in one undifferentiated list.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Resting: Story = {
  render: () => (
    <div className="max-w-xl">
      <SearchBar
        doc={japanTrip()}
        homeTimezone={HOME_TIMEZONE}
        onPickEvent={() => {}}
        onPickDay={() => {}}
        onRunCommand={() => {}}
      />
    </div>
  ),
};

/** In the width it actually has, which is a slot in a crowded toolbar. */
export const InAToolbar: Story = {
  render: () => (
    <div className="flex max-w-3xl items-center gap-3 rounded-lg border border-line bg-raised p-2">
      <span className="text-sm font-medium text-ink">japan 2026!</span>
      <div className="min-w-0 flex-1">
        <SearchBar
          doc={japanTrip()}
          homeTimezone={HOME_TIMEZONE}
          onPickEvent={() => {}}
          onPickDay={() => {}}
          onRunCommand={() => {}}
        />
      </div>
    </div>
  ),
};
