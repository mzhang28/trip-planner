import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trash2, Plus, Share2 } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: {
    children: 'Add event',
    variant: 'secondary',
    size: 'md',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">
        <Plus className="size-4" />
        Add event
      </Button>
      <Button variant="secondary">
        <Share2 className="size-4" />
        Share trip
      </Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">
        <Trash2 className="size-4" />
        Delete 3 events
      </Button>
    </div>
  ),
};

/**
 * Labels name what happens, and keep that name through the flow: the button
 * that says Share trip opens a panel headed Share trip.
 */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="primary">
        Small
      </Button>
      <Button size="md" variant="primary">
        Medium
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="primary" isDisabled>
        Save
      </Button>
      <Button variant="secondary" isDisabled>
        Share trip
      </Button>
      <Button variant="danger" isDisabled>
        Delete
      </Button>
    </div>
  ),
};

export const Icons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="Add event">
        <Plus />
      </IconButton>
      <IconButton label="Share trip" variant="secondary">
        <Share2 />
      </IconButton>
      <IconButton label="Delete event" variant="danger">
        <Trash2 />
      </IconButton>
      <IconButton label="Add event" size="sm" variant="secondary">
        <Plus />
      </IconButton>
    </div>
  ),
};
