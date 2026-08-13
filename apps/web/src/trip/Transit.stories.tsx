import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '@trip/ui';
import { HOME_TIMEZONE, japanEvent } from '../stories/japan';
import { Example } from '../stories/harness';
import { FlightSummary, JourneySummary } from './FlightFields';
import { TransitSummary } from './TransitFields';
import { TransitLeg } from './TransitLeg';

/**
 * Journeys, said three ways.
 *
 * A leg between two events is drawn in the gap between their cards, because
 * that is where the time it takes actually is. A transit event gets a summary
 * of its own — a flight's is the fullest, since a boarding pass has more on it
 * than anything else on a trip.
 */
const meta = {
  title: 'Itinerary/Transit',
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** The gap between two cards, which is where a leg belongs. */
export const Legs: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-8">
      <Example title="A drive, with nothing before it to measure against">
        <div className="flex flex-col">
          <Card className="px-3 py-2.5 text-sm text-ink">Holiday Inn Express Union Square</Card>
          <TransitLeg event={japanEvent('e_dinner_tim')} previous={undefined} />
          <Card className="px-3 py-2.5 text-sm text-ink">Dinner w/ Tim Uso</Card>
        </div>
      </Example>

      <Example title="A walk with no room for it">
        <div className="flex flex-col">
          <Card className="px-3 py-2.5 text-sm text-ink">Himeji → Onomichi</Card>
          <TransitLeg event={japanEvent('e_himeji_castle')} previous={japanEvent('e_himeji_leg')} />
          <Card className="px-3 py-2.5 text-sm text-ink">Himeji Castle</Card>
        </div>
      </Example>
    </div>
  ),
};

/** A flight, with everything a ticket carries. */
export const Flight: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-8">
      <Example title="Long haul: the clocks go forward sixteen hours">
        <FlightSummary event={japanEvent('e_sfo_nrt')} homeTimezone={HOME_TIMEZONE} />
      </Example>
      <Example title="Domestic, and the clocks go back">
        <FlightSummary event={japanEvent('e_bos_sfo')} homeTimezone={HOME_TIMEZONE} />
      </Example>
    </div>
  ),
};

/** The same shape for everything that is not a flight. */
export const Journeys: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-8">
      <Example title="Shinkansen, with a coach and a platform">
        <JourneySummary event={japanEvent('e_go_kyoto')} homeTimezone={HOME_TIMEZONE} />
      </Example>
      <Example title="A local train with two station names and nothing else">
        <JourneySummary event={japanEvent('e_mihara_leg')} homeTimezone={HOME_TIMEZONE} />
      </Example>
      <Example title="A hotel shuttle">
        <JourneySummary event={japanEvent('e_momijiya_shuttle')} homeTimezone={HOME_TIMEZONE} />
      </Example>
    </div>
  ),
};

/** The one-line version, which is what a calendar card has room for. */
export const OneLine: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-3">
      <TransitSummary event={japanEvent('e_sfo_nrt')} />
      <TransitSummary event={japanEvent('e_go_kyoto')} />
      <TransitSummary event={japanEvent('e_skyliner_out')} />
    </div>
  ),
};
