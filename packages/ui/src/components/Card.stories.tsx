import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { StatusChip } from './StatusChip';
import { StatusSpine } from './StatusSpine';

/**
 * The surface almost everything sits on.
 *
 * There are two: the card surface, which is what a list of events is made of,
 * and the raised one, which is for things that float above it — popovers,
 * dialogs, the merge preview. Nothing else in the system is allowed to invent
 * a third.
 */
const meta = {
  title: 'Components/Card',
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Surfaces: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="p-4">
        <div className="text-sm font-medium text-ink">On the page</div>
        <p className="mt-1 text-sm text-ink-secondary">
          What a list of events is made of. A subtle border and the faintest shadow, because forty
          of these are on screen at once.
        </p>
      </Card>

      <Card raised className="p-4">
        <div className="text-sm font-medium text-ink">Raised</div>
        <p className="mt-1 text-sm text-ink-secondary">
          For anything floating over the page. There is one step up, not three: a stack of shadows
          reads as clutter rather than as depth.
        </p>
      </Card>
    </div>
  ),
};

/** Cards as they are actually used, which is mostly as a row. */
export const AsRows: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-2">
      {[
        { name: 'Momijiya Annex', detail: 'Kyoto · 20:30', status: 'booked' as const },
        { name: 'wagashi class', detail: 'No day yet', status: 'idea' as const },
        {
          name: 'teamlab borderless',
          detail: 'Tokyo · tickets not bought',
          status: 'idea' as const,
        },
      ].map((row) => (
        <Card key={row.name} className="group flex overflow-hidden">
          <StatusSpine status={row.status} />
          <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{row.name}</div>
              <div className="text-2xs text-ink-muted">{row.detail}</div>
            </div>
            <StatusChip status={row.status} />
            <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton label="Edit">
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label="Delete">
                <Trash2 className="size-4" />
              </IconButton>
            </span>
          </div>
        </Card>
      ))}
    </div>
  ),
};

/** A dialog, which is a raised card with something to decide in it. */
export const AsADialog: Story = {
  render: () => (
    <Card raised className="max-w-md p-4">
      <h2 className="text-base font-semibold text-ink">Delete 3 events?</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Himeji Castle, Onomichi, and Mihara → bunnies. This can be undone for ten seconds
        afterwards.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">
          <Trash2 className="size-4" />
          Delete 3 events
        </Button>
      </div>
    </Card>
  ),
};
