import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { japanEvent } from '../stories/japan';
import { Frame } from '../stories/harness';
import { DayMap } from './DayMap';

/**
 * The day's places, on a map.
 *
 * Pins take the status colour of the card they belong to, so a pin and its
 * event read as one thing rather than as two lists about the same trip.
 * Events with no coordinates are simply not on it — a map cannot say "somewhere
 * in Kyoto", and pretending otherwise puts a pin where nobody is going.
 *
 * Tiles come from OpenStreetMap over the network. With none, the pins and the
 * controls still draw, which is the offline case.
 */
const meta = {
  title: 'Calendar/Day map',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Map({ ids, height = 420 }: { ids: string[]; height?: number }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Frame height={height}>
      <DayMap
        events={ids.map((id) => japanEvent(id))}
        selectedId={selected}
        onSelect={setSelected}
      />
    </Frame>
  );
}

/** A day spent working west along the Inland Sea: four pins, far apart. */
export const AcrossADay: Story = {
  render: () => <Map ids={['e_himeji_castle', 'e_onomichi', 'e_bunnies', 'e_arashiyama']} />,
};

/** One place, which is what most days come to. */
export const OnePlace: Story = {
  render: () => <Map ids={['e_momijiya']} />,
};

/**
 * A day where nothing has a place yet. Most of a trip looks like this while it
 * is being planned.
 */
export const NoPlaces: Story = {
  render: () => <Map ids={['e_idea_wagashi', 'e_idea_jiro']} height={260} />,
};
