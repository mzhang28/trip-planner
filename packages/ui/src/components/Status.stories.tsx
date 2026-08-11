import { BOOKING_STATUSES } from '@trip/crdt';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './Card';
import { StatusChip } from './StatusChip';
import { StatusSpine } from './StatusSpine';

const meta = {
  title: 'Foundations/Booking status',
  parameters: {
    docs: {
      description: {
        component:
          'How settled a booking is, shown three ways: a spine down the edge of a card, a dot inside a chip, and a pin on the map. Each status has its own pattern as well as its own colour, so the three read the same to someone who cannot tell the green from the amber.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Spines: Story = {
  render: () => (
    <div className="flex gap-8">
      {BOOKING_STATUSES.map((status) => (
        <div key={status} className="flex flex-col items-center gap-2">
          <div className="h-24">
            <StatusSpine status={status} className="w-1" />
          </div>
          <span className="font-mono text-2xs text-ink-muted">{status}</span>
        </div>
      ))}
    </div>
  ),
};

export const Chips: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {BOOKING_STATUSES.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {BOOKING_STATUSES.map((status) => (
          <StatusChip key={status} status={status} short />
        ))}
      </div>
      <p className="max-w-md text-sm text-ink-secondary">
        The short labels are for a column too narrow for the full ones. Holding says more than
        Pending about what is actually true: someone is sitting on a reservation that is not yet
        paid for.
      </p>
    </div>
  ),
};

/** The spine in the place it was designed for. */
export const OnCards: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-2">
      {[
        { name: 'Fushimi Inari at dawn', time: '05:30', status: 'booked' as const },
        { name: 'Nishiki Market lunch', time: '12:00', status: 'in_progress' as const },
        { name: 'Pottery studio, maybe', time: '15:00', status: 'idea' as const },
      ].map((event) => (
        <Card key={event.name} className="flex overflow-hidden">
          <StatusSpine status={event.status} />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{event.name}</div>
              <div className="tabular text-2xs text-ink-muted">{event.time}</div>
            </div>
            <StatusChip status={event.status} short />
          </div>
        </Card>
      ))}
    </div>
  ),
};

export const WithoutColour: Story = {
  render: () => (
    <div className="max-w-md">
      <p className="mb-4 text-sm text-ink-secondary">
        The same three cards with colour removed. The status still reads, which is the test the
        pattern exists to pass.
      </p>
      <div className="flex flex-col gap-2" style={{ filter: 'grayscale(1)' }}>
        {[
          { name: 'Fushimi Inari at dawn', status: 'booked' as const },
          { name: 'Nishiki Market lunch', status: 'in_progress' as const },
          { name: 'Pottery studio, maybe', status: 'idea' as const },
        ].map((event) => (
          <Card key={event.name} className="flex overflow-hidden">
            <StatusSpine status={event.status} />
            <div className="px-3 py-2.5 text-sm text-ink">{event.name}</div>
          </Card>
        ))}
      </div>
    </div>
  ),
};
