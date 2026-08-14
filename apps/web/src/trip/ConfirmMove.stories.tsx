import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmMove } from './ConfirmMove';

/**
 * What a confirmed event asks before a drag in the week moves it.
 *
 * Dragging is how a plan gets rearranged, so it stays free for anything still
 * flexible. A confirmed event is different: the plan is the record of what was
 * booked, and a card knocked to the next day would rewrite that record with
 * nothing on screen to say it happened.
 */
const meta = {
  title: 'Calendar/Confirm a move',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Half an hour later on the same day: the commonest slip, and the smallest. */
export const SameDay: Story = {
  name: 'A slip of half an hour',
  render: () => (
    <ConfirmMove
      move={{
        id: 'e_sfo_nrt',
        name: 'SFO → NRT',
        from: { day: '2026-05-20', minutes: 20 * 60 + 15 },
        to: { day: '2026-05-20', minutes: 20 * 60 + 45 },
      }}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};

/** Dragged sideways, which is the one that would cost somebody a flight. */
export const AnotherDay: Story = {
  name: 'Onto another day',
  render: () => (
    <ConfirmMove
      move={{
        id: 'e_sfo_nrt',
        name: 'SFO → NRT',
        from: { day: '2026-05-20', minutes: 20 * 60 + 15 },
        to: { day: '2026-05-21', minutes: 11 * 60 },
      }}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};

/** A booking nobody has named yet still has to be asked about. */
export const Unnamed: Story = {
  render: () => (
    <ConfirmMove
      move={{
        id: 'e_new',
        name: '',
        from: { day: '2026-05-22', minutes: 9 * 60 },
        to: { day: '2026-05-22', minutes: 13 * 60 + 30 },
      }}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};
