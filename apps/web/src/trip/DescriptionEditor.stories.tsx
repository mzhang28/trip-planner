import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { japanTrip } from '../stories/japan';
import { Example } from '../stories/harness';
import { Description, DescriptionEditor } from './DescriptionEditor';

/**
 * A description that can point at the rest of the trip.
 *
 * Typing `@` offers the events, places and files on this trip; what is stored
 * is the id, so renaming an event renames every mention of it. A mention whose
 * target has gone keeps the words that were written and says it is gone, which
 * tells the reader more than a gap where a name used to be.
 */
const meta = {
  title: 'Fields/Description',
} satisfies Meta;

export default meta;
type Story = StoryObj;

const WITH_MENTION =
  'Same hotel as the first night: @[Sotetsu Fresa Inn Ueno](event:e_ueno_stay). Drop the bags there before @[Harry mogumogu](event:e_harry).';

const WITH_GHOST =
  'Book this the same day as @[the pottery studio](event:e_gone), if it is still there.';

export const Editing: Story = {
  render: function Editing() {
    const [value, setValue] = useState(
      'Bag drop closes 60 min before. Type @ to point at something else on the trip.',
    );

    return (
      <div className="max-w-xl">
        <DescriptionEditor
          value={value}
          doc={japanTrip()}
          eventId="e_sfo_nrt"
          onChange={setValue}
          onOpenEvent={() => {}}
        />
      </div>
    );
  },
};

/** How one reads once it is written. */
export const Reading: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-8 text-sm text-ink">
      <Example title="Mentions resolved against the trip as it is now">
        <Description text={WITH_MENTION} doc={japanTrip()} onOpenEvent={() => {}} />
      </Example>
      <Example title="A mention whose event has been deleted">
        <Description text={WITH_GHOST} doc={japanTrip()} onOpenEvent={() => {}} />
      </Example>
      <Example title="Plain text, which is most of them">
        <Description
          text={
            'Ferry from Tadanoumi.\nBuy rabbit food at the station — there is none on the island.'
          }
          doc={japanTrip()}
          onOpenEvent={() => {}}
        />
      </Example>
    </div>
  ),
};
