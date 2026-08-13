import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CITY_COLORS,
  HOME_TIMEZONE,
  TODAY,
  TRIP_END,
  TRIP_START,
  japanEvents,
  japanWeather,
} from '../stories/japan';
import { Frame } from '../stories/harness';
import { MonthView } from './MonthView';

/**
 * A month at a glance, with the trip's shape on it.
 *
 * The cells are mostly a place ribbon and a count: at this zoom the useful
 * question is "where are we that week", not "what time is the ferry". The
 * ribbon is coloured per city and runs across the days spent there, which is
 * the one thing a month can say that a week cannot.
 */
const meta = {
  title: 'Calendar/Month',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Month({ anchor, readOnly = false }: { anchor: string; readOnly?: boolean }) {
  return (
    <Frame height={640}>
      <MonthView
        anchor={anchor}
        tripStart={TRIP_START}
        tripEnd={TRIP_END}
        events={japanEvents()}
        cityColors={CITY_COLORS}
        homeTimezone={HOME_TIMEZONE}
        weather={japanWeather()}
        today={TODAY}
        readOnly={readOnly}
        onOpenDay={() => {}}
        onOpenEvent={() => {}}
        onCreateOn={() => {}}
      />
    </Frame>
  );
}

/** May: the trip starts a third of the way in and fills the rest. */
export const May: Story = {
  render: () => <Month anchor="2026-05-22" />,
};

/** June: four days of trip and a month of nothing, which is most months. */
export const June: Story = {
  render: () => <Month anchor="2026-06-03" />,
};

export const ReadOnly: Story = {
  render: () => <Month anchor="2026-05-22" readOnly />,
};
