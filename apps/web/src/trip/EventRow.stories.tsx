import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Example, useEventCallbacks, useTrip } from '../stories/harness';
import { EventRow, type EventExpansion } from './EventRow';

/**
 * One event in the itinerary list, closed and open.
 *
 * Everything about an event is reachable from this card, which is why it is
 * the busiest thing in the app: a name, a time, a status, a place, links,
 * to-dos, files, custom fields, and a whole flight's worth of detail behind
 * one of the kinds. The stories below are mostly about how much of that can
 * be on screen at once before it stops reading as one thing.
 */
const meta = {
  title: 'Itinerary/Event card',
  parameters: {
    docs: {
      description: {
        component:
          'The card opens in place rather than into a dialog: most edits here are a single field, and a round trip to another surface costs more attention than the edit does.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

interface RowProps {
  eventId: string;
  expansion?: EventExpansion;
  readOnly?: boolean;
}

/** A card wired to a document, so everything on it actually works. */
function Row({ eventId, expansion = 'closed', readOnly = false }: RowProps) {
  const trip = useTrip();
  const callbacks = useEventCallbacks(trip, eventId);
  const [shows, setShows] = useState<EventExpansion>(expansion);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const event = trip.doc.events[eventId];
  if (!event) return null;

  return (
    <EventRow
      event={event}
      homeTimezone={callbacks.homeTimezone}
      fieldDefs={callbacks.fieldDefs}
      doc={trip.doc}
      readOnly={readOnly}
      expansion={shows}
      onExpansionChange={setShows}
      revealed={revealed}
      onReveal={(key) => setRevealed((was) => new Set(was).add(key))}
      onRemoveField={() => {}}
      onPatch={callbacks.onPatch}
      onAddLink={callbacks.onAddLink}
      onRemoveLink={callbacks.onRemoveLink}
      onSetCustomField={callbacks.onSetCustomField}
      onSetCityColor={callbacks.onSetCityColor}
      onAddAttachment={callbacks.onAddAttachment}
      onRemoveAttachment={callbacks.onRemoveAttachment}
      onAddTodo={callbacks.onAddTodo}
      onUpdateTodo={callbacks.onUpdateTodo}
      onRemoveTodo={callbacks.onRemoveTodo}
      onDelete={callbacks.onDelete}
      onOpenEvent={callbacks.onOpenEvent}
    />
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <div className="flex max-w-2xl flex-col gap-2">{children}</div>;
}

/**
 * The four kinds, closed. A day of a real itinerary is mostly this: a stack of
 * one-line cards where the differences between them have to survive being read
 * at a glance.
 */
export const Kinds: Story = {
  render: () => (
    <List>
      <Row eventId="e_arashiyama" />
      <Row eventId="e_go_kyoto" />
      <Row eventId="e_momijiya" />
      <Row eventId="e_note_cash" />
    </List>
  ),
};

/** The states an event passes through, and how much each one shows. */
export const States: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-8">
      <Example title="Booked, with a confirmation code">
        <Row eventId="e_bos_sfo" />
      </Example>
      <Example title="Pending — asked for, not confirmed">
        <Row eventId="e_idea_teamlab" />
      </Example>
      <Example title="An idea with a day but no hour">
        <Row eventId="e_uji" />
      </Example>
      <Example title="An idea with nothing but a name">
        <Row eventId="e_idea_wagashi" />
      </Example>
    </div>
  ),
};

/**
 * Open, which is where the field palette lives. Everything not yet on the
 * event is offered as a chip rather than sitting there as an empty input.
 */
export const Open: Story = {
  render: () => (
    <List>
      <Row eventId="e_momijiya" expansion="details" />
    </List>
  ),
};

/**
 * The editor, which is one press of Edit further in. Opening straight to it is
 * for the moments where the person clearly meant to write: Add event, a tap on
 * an empty day, a double click on the name.
 */
export const Editing: Story = {
  render: () => (
    <List>
      <Row eventId="e_momijiya" expansion="editor" />
    </List>
  ),
};

/** A flight open: the one kind with a whole form of its own. */
export const OpenFlight: Story = {
  name: 'Open (flight)',
  render: () => (
    <List>
      <Row eventId="e_sfo_nrt" expansion="details" />
    </List>
  ),
};

/** A viewer's copy: nothing on it implies an edit. */
export const ReadOnly: Story = {
  render: () => (
    <List>
      <Row eventId="e_hiroshima_stay" readOnly expansion="details" />
      <Row eventId="e_miyajima" readOnly />
    </List>
  ),
};

/**
 * Names longer than the card, which is most hotel names and every idea typed
 * in a hurry.
 */
export const LongNames: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-2">
      <Row eventId="e_kyoto_stay" />
      <Row eventId="e_hiroshima_free" />
      <Row eventId="e_skyliner_out" />
    </div>
  ),
};
