import {
  addAttachment,
  addLink,
  addTodo,
  deleteEvent,
  liveEvents,
  liveFieldDefs,
  removeAttachment,
  removeLink,
  removeTodo,
  setCityColor,
  setCustomField,
  updateEvent,
  updateTodo,
  type Author,
  type Doc,
  type EditableTodo,
  type EventAttachment,
  type CustomValue,
  type FieldDefId,
} from '@trip/crdt';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { Decorator } from '@storybook/react-vite';
import { installApiStub } from './apiStub';
import { HOME_TIMEZONE, japanTrip } from './japan';

/**
 * What a story stands a component up in.
 *
 * The app hands its components a document, a pile of callbacks that write to
 * it, and a router. Here the document is the fixture, the callbacks write to a
 * copy held in the story's own state, and the router is a memory one. A story
 * is then genuinely interactive — typing into an event card changes the card —
 * without a server, a socket, or anything that survives a refresh.
 */

// Installed on import: every story in the app's catalogue pulls this in, and a
// component that fetches on mount does it before any decorator could run.
installApiStub();

export const STORY_AUTHOR: Author = { userId: 'u_michael' };

export interface TripHandle {
  doc: Doc;
  /** Applies a change and keeps the result, the way the app's store does. */
  apply: (change: (doc: Doc) => Doc) => void;
  reset: () => void;
}

export function useTrip(): TripHandle {
  const [doc, setDoc] = useState<Doc>(japanTrip);

  const apply = useCallback((change: (current: Doc) => Doc) => {
    setDoc((current) => change(current));
  }, []);

  const reset = useCallback(() => setDoc(japanTrip()), []);

  return { doc, apply, reset };
}

/**
 * Every callback an event card asks for, wired to the story's document.
 *
 * There are eighteen of them and they are the same eighteen in every story
 * that shows a card, so they are built once here. A story that wants to watch
 * one of them can still pass its own over the top.
 */
export function useEventCallbacks(trip: TripHandle, eventId: string) {
  return useMemo(
    () => ({
      onPatch: (patch: Record<string, unknown>) =>
        trip.apply((doc) => updateEvent(doc, eventId, patch, STORY_AUTHOR)),
      onAddLink: (url: string, title: string | undefined) =>
        trip.apply((doc) => addLink(doc, eventId, `l_${Date.now()}`, { url, title }, STORY_AUTHOR)),
      onRemoveLink: (linkId: string) =>
        trip.apply((doc) => removeLink(doc, eventId, linkId, STORY_AUTHOR)),
      onSetCustomField: (fieldId: FieldDefId, value: CustomValue | undefined) =>
        trip.apply((doc) => setCustomField(doc, eventId, fieldId, value, STORY_AUTHOR)),
      onSetCityColor: (city: string, color: string | undefined) =>
        trip.apply((doc) => setCityColor(doc, city, color)),
      onAddAttachment: (id: string, attachment: EventAttachment) =>
        trip.apply((doc) => addAttachment(doc, eventId, id, attachment, STORY_AUTHOR)),
      onRemoveAttachment: (id: string) =>
        trip.apply((doc) => removeAttachment(doc, eventId, id, STORY_AUTHOR)),
      onAddTodo: (text: string, deadline: string | undefined) =>
        trip.apply((doc) =>
          addTodo(doc, eventId, `t_${Date.now()}`, { text, deadline }, STORY_AUTHOR),
        ),
      onUpdateTodo: (id: string, patch: Partial<EditableTodo>) =>
        trip.apply((doc) => updateTodo(doc, eventId, id, patch, STORY_AUTHOR)),
      onRemoveTodo: (id: string) => trip.apply((doc) => removeTodo(doc, eventId, id, STORY_AUTHOR)),
      onDelete: () => trip.apply((doc) => deleteEvent(doc, eventId, STORY_AUTHOR)),
      onOpenEvent: () => {},
      homeTimezone: HOME_TIMEZONE,
      doc: trip.doc,
      fieldDefs: liveFieldDefs(trip.doc),
      events: liveEvents(trip.doc),
    }),
    [trip, eventId],
  );
}

/** Routing, for anything with a link in it. */
export const withRouter: Decorator = (Story) => (
  <MemoryRouter initialEntries={['/t/japan-2026']}>
    <Story />
  </MemoryRouter>
);

export interface FrameProps {
  /** What this example is showing, in one line. */
  note?: string;
  /** A fixed height, for a view that fills whatever it is given. */
  height?: number | string;
  width?: number | string;
  children: ReactNode;
}

/**
 * A bordered pane of a stated size.
 *
 * The week and the month are drawn to fill a window, and a story that lets
 * them do that on a Storybook docs page shows a component with no edges — you
 * cannot tell what is padding and what is the end of the screen. This gives
 * them an edge to reach, at a size a story can name.
 */
export function Frame({ note, height = 560, width, children }: FrameProps) {
  return (
    <div className="flex flex-col gap-2">
      {note && <p className="text-sm text-ink-secondary">{note}</p>}
      <div
        style={{ height, width }}
        // A column, because the views inside are `flex-1` and expect to be
        // handed a height the way the app's route hands them one.
        className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-card"
      >
        {children}
      </div>
    </div>
  );
}

/** A heading above a group of examples inside one story. */
export function Example({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-2xs font-medium tracking-wide text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
