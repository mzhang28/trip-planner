import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  addEvent,
  addLink,
  deleteEvent,
  liveFieldDefs,
  removeLink,
  setCustomField,
  updateEvent,
  type CustomValue,
  type EditableEventFields,
  type FieldDefId,
  type TripDoc,
  type TripEvent,
} from '@trip/crdt';
import { Button, TextField, ThemeToggle } from '@trip/ui';
import { GripVertical, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type TripSummary } from '../lib/api';
import { dayKey, formatDayHeading, moveToDay } from '../lib/time';
import { DayDropZone, DraggableEvent } from '../trip/DayDropZone';
import { EventRow } from '../trip/EventRow';
import { SearchBar } from '../trip/SearchBar';
import { SyncBadge } from '../trip/SyncBadge';
import type { CommandId } from '../trip/search';
import { useEvents, useTripState, useTripStore } from '../trip/useTrip';

const UNSCHEDULED = 'unscheduled';

function groupByDay(events: TripEvent[], homeTimezone: string) {
  const days = new Map<string, TripEvent[]>();

  for (const event of events) {
    const key =
      event.startsAt === undefined
        ? UNSCHEDULED
        : dayKey(event.startsAt, event.timezone ?? homeTimezone);

    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }

  return [...days.entries()];
}

export function TripView() {
  const { tripId } = useParams<{ tripId: string }>();
  const store = useTripStore(tripId);
  const state = useTripState(store);
  const events = useEvents(state);

  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [draft, setDraft] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const addBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tripId) return;
    void api
      .getTrip(tripId)
      .then(setTrip)
      .catch(() => setTrip(null));
  }, [tripId]);

  const doc = state?.doc as TripDoc | undefined;
  const homeTimezone = trip?.homeTimezone ?? doc?.meta?.homeTimezone ?? 'UTC';
  const readOnly = trip?.role === 'viewer';
  const days = useMemo(() => groupByDay(events, homeTimezone), [events, homeTimezone]);
  const fieldDefs = useMemo(() => liveFieldDefs(doc), [doc]);

  /*
   * The keyboard sensor is not optional. Dragging is the only way to move an
   * event between days, so without it that operation would be unreachable for
   * anyone not using a pointer. The grip is a real button, so it is tabbed to
   * and driven with the arrow keys.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const create = useCallback(() => {
    const name = draft.trim();
    if (!name || !store) return;

    store.change((current) =>
      addEvent(current, { id: `e_${crypto.randomUUID()}`, name }, { userId: 'me' }),
    );
    setDraft('');
  }, [draft, store]);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || !store) return;

    const targetDay = String(over.id).replace(/^day:/, '');
    const event = events.find((candidate) => candidate.id === active.id);
    if (!event || targetDay === UNSCHEDULED) return;

    const zone = event.timezone ?? homeTimezone;
    // Something with no time yet gets one when it lands on a day: midday, which
    // reads as "this day, time still to work out" rather than midnight.
    const from = event.startsAt ?? Date.parse(`${targetDay}T12:00:00Z`);
    const startsAt = moveToDay(from, zone, targetDay);
    if (startsAt === null || startsAt === event.startsAt) return;

    store.change((current) =>
      updateEvent(current, event.id, { startsAt, timezone: zone }, { userId: 'me' }),
    );
  }

  function goToDay(at: number) {
    const key = dayKey(at, homeTimezone);
    document.querySelector(`[data-testid="day-${key}"]`)?.scrollIntoView({ block: 'center' });
  }

  function focusEvent(eventId: string) {
    setHighlighted(eventId);
    document.getElementById(`event-${eventId}`)?.scrollIntoView({ block: 'center' });
  }

  async function share() {
    if (!tripId) return;
    const { token } = await api.createShareLink(tripId, 'editor');
    setShareUrl(`${location.origin}/join/${token}`);
  }

  function runCommand(command: CommandId) {
    if (command === 'new-event') {
      addBoxRef.current?.querySelector('input')?.focus();
    } else if (command === 'today') {
      goToDay(Date.now());
    } else if (command === 'share') {
      void share();
    }
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="text-xs text-ink-muted underline-offset-2 hover:underline">
            All trips
          </Link>
          <h1 className="truncate text-lg">{trip?.name ?? 'Trip'}</h1>
          <Link
            to={`/t/${tripId}/fields`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline"
          >
            Fields
          </Link>
          <SyncBadge state={state} />
          <div className="hidden sm:flex sm:min-w-0 sm:flex-1">
            <SearchBar
              doc={doc}
              homeTimezone={homeTimezone}
              onPickEvent={focusEvent}
              onPickDay={goToDay}
              onRunCommand={runCommand}
            />
          </div>
          <ThemeToggle />
        </div>

        {/* Below the small breakpoint the search box gets the whole row. */}
        <div className="mx-auto max-w-3xl px-4 pb-3 sm:hidden">
          <SearchBar
            doc={doc}
            homeTimezone={homeTimezone}
            onPickEvent={focusEvent}
            onPickDay={goToDay}
            onRunCommand={runCommand}
          />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {!readOnly && (
          <div ref={addBoxRef} className="mb-6 flex items-end gap-2">
            <TextField
              label="New event"
              labelHidden
              className="flex-1"
              placeholder="Add something — a name is enough"
              value={draft}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />
            <Button variant="primary" onPress={create} isDisabled={draft.trim() === ''}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        )}

        {events.length === 0 && (
          <p className="py-10 text-center text-ink-secondary">
            Nothing here yet. Add the first thing you know about — where you are staying, or the
            flight out.
          </p>
        )}

        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {days.map(([key, dayEvents]) => (
            <section key={key} className="mb-8">
              <h2 className="mb-2 text-sm text-ink-muted">
                {key === UNSCHEDULED
                  ? 'No time yet'
                  : formatDayHeading(
                      dayEvents[0]!.startsAt!,
                      dayEvents[0]!.timezone ?? homeTimezone,
                    )}
              </h2>

              <DayDropZone dayKey={key} disabled={readOnly || key === UNSCHEDULED}>
                <div className="flex flex-col gap-2">
                  {dayEvents.map((event) => (
                    <DraggableEvent key={event.id} id={event.id} disabled={readOnly}>
                      {(handle) => (
                        <div
                          id={`event-${event.id}`}
                          className={
                            highlighted === event.id ? 'rounded-lg ring-2 ring-accent' : undefined
                          }
                        >
                          <EventRow
                            dragHandle={
                              handle ? (
                                <button
                                  {...handle}
                                  type="button"
                                  aria-label={`Move ${event.name} to another day`}
                                  className="cursor-grab touch-none px-1 text-ink-placeholder hover:text-ink-muted focus-visible:outline-focus focus-visible:outline-2"
                                >
                                  <GripVertical aria-hidden="true" className="size-4" />
                                </button>
                              ) : undefined
                            }
                            event={event}
                            homeTimezone={homeTimezone}
                            fieldDefs={fieldDefs}
                            readOnly={readOnly}
                            onPatch={(patch) =>
                              store?.change((current) =>
                                updateEvent(
                                  current,
                                  event.id,
                                  patch as Partial<EditableEventFields>,
                                  { userId: 'me' },
                                ),
                              )
                            }
                            onAddLink={(url, title) =>
                              store?.change((current) =>
                                addLink(
                                  current,
                                  event.id,
                                  `l_${crypto.randomUUID()}`,
                                  { url, title },
                                  { userId: 'me' },
                                ),
                              )
                            }
                            onRemoveLink={(linkId) =>
                              store?.change((current) =>
                                removeLink(current, event.id, linkId, { userId: 'me' }),
                              )
                            }
                            onSetCustomField={(fieldId: FieldDefId, value: CustomValue | undefined) =>
                              store?.change((current) =>
                                setCustomField(current, event.id, fieldId, value, {
                                  userId: 'me',
                                }),
                              )
                            }
                            onDelete={() =>
                              store?.change((current) =>
                                deleteEvent(current, event.id, { userId: 'me' }),
                              )
                            }
                          />
                        </div>
                      )}
                    </DraggableEvent>
                  ))}
                </div>
              </DayDropZone>
            </section>
          ))}
        </DndContext>

        {trip?.role === 'owner' && (
          <section className="mt-10 border-t border-line pt-6">
            <Button onPress={() => void share()}>Share trip</Button>
            {shareUrl && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">
                  Anyone with this link can edit the trip. It is shown once.
                </p>
                <code className="block rounded-md bg-sunken px-2 py-1.5 text-xs break-all">
                  {shareUrl}
                </code>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
