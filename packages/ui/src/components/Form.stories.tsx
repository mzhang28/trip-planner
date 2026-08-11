import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl';
import { TextField } from './TextField';
import { ThemeToggle } from './ThemeToggle';

const meta = {
  title: 'Components/Form',
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Fields: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-5">
      <TextField label="Event name" placeholder="Fushimi Inari at dawn" />
      <TextField
        label="Confirmation code"
        placeholder="7K2QLM"
        description="From the booking email. Shown on the event and searchable."
      />
      <TextField
        label="Event name"
        value=""
        errorMessage="Give the event a name. Everything else can wait."
      />
      <TextField label="Notes" multiline placeholder="Bring cash, the tea house has no card reader" />
      <TextField label="Trip name" value="Japan, April" isDisabled />
    </div>
  ),
};

const VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
] as const;

export const Segmented: Story = {
  render: function Render() {
    const [view, setView] = useState<'month' | 'week' | 'day'>('week');

    return (
      <div className="flex flex-col items-start gap-6">
        <SegmentedControl label="Calendar view" options={VIEWS} value={view} onChange={setView} />
        <p className="text-sm text-ink-secondary">
          Showing the <span className="font-medium text-ink">{view}</span>. Arrow keys move between
          the options, and a screen reader announces the position in the group.
        </p>
      </div>
    );
  },
};

export const Theme: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <ThemeToggle />
      <p className="max-w-md text-sm text-ink-secondary">
        This one writes to the document, so it drives the page rather than the Storybook toolbar.
        Use the toolbar control above to preview a component in both themes at once.
      </p>
    </div>
  ),
};
