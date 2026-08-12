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
          'Whether an event is flexible or confirmed, shown three ways: a spine down the edge of a card, a dot inside a chip, and a pin on the map. Each state has its own pattern as well as its own colour.',
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
    <div className="flex flex-wrap items-center gap-2">
      {BOOKING_STATUSES.map((status) => (
        <StatusChip key={status} status={status} />
      ))}
    </div>
  ),
};

/** The spine in the place it was designed for. */
export const OnCards: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-2">
      {[
        { name: 'Fushimi Inari at dawn', time: '05:30', status: 'booked' as const },
        { name: 'Pottery studio, maybe', time: '15:00', status: 'idea' as const },
      ].map((event) => (
        <Card key={event.name} className="flex overflow-hidden">
          <StatusSpine status={event.status} />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{event.name}</div>
              <div className="tabular text-2xs text-ink-muted">{event.time}</div>
            </div>
            <StatusChip status={event.status} />
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
        The same two cards with colour removed. The status still reads, which is the test the
        pattern exists to pass.
      </p>
      <div className="flex flex-col gap-2" style={{ filter: 'grayscale(1)' }}>
        {[
          { name: 'Fushimi Inari at dawn', status: 'booked' as const },
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
