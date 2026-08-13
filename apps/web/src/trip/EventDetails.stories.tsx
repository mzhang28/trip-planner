import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '@trip/ui';
import {
  CITY_COLORS,
  HOME_TIMEZONE,
  TOKYO,
  japanEvent,
  japanFieldDefs,
  japanTrip,
} from '../stories/japan';
import { Example } from '../stories/harness';
import { EventDetails } from './EventDetails';

/**
 * What an event says about itself when it is not being edited.
 *
 * Only what has been filled in appears: an event with a name and nothing else
 * shows a name and nothing else, rather than a form of empty boxes reporting
 * everything the trip does not know yet.
 */
const meta = {
  title: 'Itinerary/Event details',
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Details({ id, zone = TOKYO }: { id: string; zone?: string }) {
  return (
    <Card className="p-3">
      <EventDetails
        event={japanEvent(id)}
        homeTimezone={HOME_TIMEZONE}
        zone={zone}
        fieldDefs={japanFieldDefs()}
        cityColors={CITY_COLORS}
        doc={japanTrip()}
        onOpenEvent={() => {}}
      />
    </Card>
  );
}

/** How much detail an event carries, from all of it to none. */
export const Filled: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-8">
      <Example title="A stay with a note, a code, a place, and a cost">
        <Details id="e_momijiya" />
      </Example>
      <Example title="An idea with a link and a reason to book early">
        <Details id="e_idea_teamlab" />
      </Example>
      <Example title="A flight with to-dos still open">
        <Details id="e_sfo_nrt" />
      </Example>
      <Example title="A note, which is all description">
        <Details id="e_note_cash" />
      </Example>
      <Example title="A name and nothing else">
        <Details id="e_idea_jiro" />
      </Example>
    </div>
  ),
};
