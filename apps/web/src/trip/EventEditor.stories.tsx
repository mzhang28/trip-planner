import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from '@trip/ui';
import { useState } from 'react';
import { Example, useEventCallbacks, useTrip } from '../stories/harness';
import { EventEditor } from './EventEditor';
import { EventTodos } from './EventTodos';
import { FieldPalette } from './FieldPalette';

/**
 * The editing half of an event card, and the two parts of it worth looking at
 * on their own.
 *
 * An event starts as a name and grows as things get decided, so the editor
 * shows what is filled in and offers the rest as chips. A wall of empty inputs
 * would ask twenty questions of somebody who has answered one.
 */
const meta = {
  title: 'Itinerary/Event editor',
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Editor({ eventId }: { eventId: string }) {
  const trip = useTrip();
  const callbacks = useEventCallbacks(trip, eventId);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const event = trip.doc.events[eventId];
  if (!event) return null;

  return (
    <Card className="max-w-2xl p-3">
      <EventEditor
        event={event}
        homeTimezone={callbacks.homeTimezone}
        fieldDefs={callbacks.fieldDefs}
        doc={trip.doc}
        revealed={revealed}
        onReveal={(key) => setRevealed((was) => new Set(was).add(key))}
        onRemoveField={() => {}}
        onClose={() => {}}
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
    </Card>
  );
}

/** An idea with nothing on it: the palette is most of what there is. */
export const Bare: Story = {
  render: () => <Editor eventId="e_idea_kirby" />,
};

/** A stay, with a place, a code, a note and a custom field already answered. */
export const Filled: Story = {
  render: () => <Editor eventId="e_momijiya" />,
};

/** A flight, which brings a form of its own. */
export const Flight: Story = {
  render: () => <Editor eventId="e_sfo_nrt" />,
};

/** The palette on its own, folded and unfolded. */
export const Palette: Story = {
  render: function Palette() {
    const chips = [
      { key: 'when', label: 'When' },
      { key: 'duration', label: 'How long' },
      { key: 'city', label: 'City' },
      { key: 'place', label: 'Place' },
      { key: 'confirmation', label: 'Confirmation code' },
      { key: 'note', label: 'Note' },
      { key: 'description', label: 'Description' },
      { key: 'links', label: 'Links' },
      { key: 'todos', label: 'To-dos' },
      { key: 'files', label: 'Files' },
      { key: 'f_cost', label: 'Cost per person' },
      { key: 'f_who', label: 'Booked by' },
    ];

    return (
      <div className="flex max-w-2xl flex-col gap-8">
        <Example title="Folded, which is how it arrives">
          <FieldPalette chips={chips} onAdd={() => {}} />
        </Example>
        <Example title="Only a few left to offer">
          <FieldPalette chips={chips.slice(0, 3)} onAdd={() => {}} />
        </Example>
      </div>
    );
  },
};

/** To-dos, which are per event rather than one list for the whole trip. */
export const Todos: Story = {
  render: function Todos() {
    const trip = useTrip();
    const callbacks = useEventCallbacks(trip, 'e_sfo_nrt');
    const event = trip.doc.events.e_sfo_nrt;

    return (
      <Card className="max-w-lg p-3">
        <EventTodos
          todos={event?.todos ?? {}}
          onAdd={callbacks.onAddTodo}
          onUpdate={callbacks.onUpdateTodo}
          onRemove={callbacks.onRemoveTodo}
        />
      </Card>
    );
  },
};
