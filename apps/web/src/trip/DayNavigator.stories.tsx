import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TODAY, TRIP_END, TRIP_START } from '../stories/japan';
import { Example } from '../stories/harness';
import { DayNavigator, type CalendarView } from './DayNavigator';

/**
 * Moving about the trip, in whatever unit the current view is drawn in.
 *
 * The strip is finite: it runs from the first day of the trip to the last and
 * stops, because a trip has ends and a calendar that scrolls forever invites
 * people to wander off the plan and wonder where it went.
 */
const meta = {
  title: 'Calendar/Day navigator',
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Navigator({ view, anchor = TODAY }: { view: CalendarView; anchor?: string }) {
  const [day, setDay] = useState(anchor);

  return (
    <DayNavigator
      view={view}
      anchor={day}
      today={TODAY}
      tripStart={TRIP_START}
      tripEnd={TRIP_END}
      onChange={setDay}
    />
  );
}

/** All three, so the change of unit between them can be compared at once. */
export const Views: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-8">
      <Example title="Day">
        <Navigator view="day" />
      </Example>
      <Example title="Week">
        <Navigator view="week" />
      </Example>
      <Example title="Month">
        <Navigator view="month" />
      </Example>
    </div>
  ),
};

/** At the first day of the trip, where the strip runs out on the left. */
export const AtTheStart: Story = {
  render: () => (
    <div className="max-w-3xl">
      <Navigator view="day" anchor={TRIP_START} />
    </div>
  ),
};

/** At the last, where it runs out on the right. */
export const AtTheEnd: Story = {
  render: () => (
    <div className="max-w-3xl">
      <Navigator view="day" anchor={TRIP_END} />
    </div>
  ),
};

/** Narrow, the way it is on a phone. */
export const Narrow: Story = {
  render: () => (
    <div className="max-w-xs">
      <Navigator view="week" />
    </div>
  ),
};
