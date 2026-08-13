import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { japanEvent, japanEvents } from '../stories/japan';
import { Example } from '../stories/harness';
import { MergePreview, SelectionBar } from './SelectionBar';

/**
 * What can be done to several events at once, and what merging them would do.
 *
 * The bar only exists while something is ticked, and it says how many rather
 * than "items": a count of a named thing is easier to check against what you
 * meant to select than a number beside a word that could mean anything.
 */
const meta = {
  title: 'Itinerary/Selection',
} satisfies Meta;

export default meta;
type Story = StoryObj;

const DAY = ['e_himeji_castle', 'e_onomichi', 'e_bunnies', 'e_hiroshima_leg'];

function Bar({ ids }: { ids: string[] }) {
  const [selected, setSelected] = useState(new Set(ids));
  const events = japanEvents();

  return (
    <SelectionBar
      selected={selected}
      events={events}
      dayEvents={DAY.map((id) => japanEvent(id))}
      dayLabel="Saturday 30 May"
      onSelectAll={(all) => setSelected(new Set(all))}
      onClear={() => setSelected(new Set())}
      onDelete={() => setSelected(new Set())}
      onMerge={() => {}}
    />
  );
}

export const Counts: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-8">
      <Example title="One">
        <Bar ids={['e_himeji_castle']} />
      </Example>
      <Example title="Two — enough to merge">
        <Bar ids={['e_himeji_castle', 'e_onomichi']} />
      </Example>
      <Example title="A whole day">
        <Bar ids={DAY} />
      </Example>
    </div>
  ),
};

/**
 * Merging, before it happens.
 *
 * Two people adding the same place is the ordinary case, so the preview shows
 * which record survives and what it takes from the others — a merge that only
 * announced itself afterwards would be a delete with extra steps.
 */
export const Merging: Story = {
  render: function Merging() {
    const [primary, setPrimary] = useState('e_idea_inari');

    const involved = ['e_idea_inari', 'e_idea_meiji', 'e_idea_ueno'].map((id) => japanEvent(id));
    const chosen = involved.find((event) => event.id === primary) ?? involved[0]!;

    return (
      <div className="max-w-2xl">
        <MergePreview
          primary={chosen}
          others={involved.filter((event) => event.id !== chosen.id)}
          onChangePrimary={setPrimary}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </div>
    );
  },
};
