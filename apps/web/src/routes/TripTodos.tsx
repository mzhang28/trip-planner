import { updateTodo, type TripDoc } from '@trip/crdt';
import { Card, ThemeToggle, cn } from '@trip/ui';
import { CalendarClock, CalendarDays, ListChecks } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type TripSummary } from '../lib/api';
import { eventTodos, formatTodoDeadline, type TodoEntry } from '../lib/todos';
import { SyncBadge } from '../trip/SyncBadge';
import { PHONE, useMediaQuery } from '../lib/useMediaQuery';
import { TripChrome } from '../trip/TripChrome';
import { useEvents, useTripState, useTripStore } from '../trip/useTrip';

function TodoRow({
  entry,
  readOnly,
  onToggle,
}: {
  entry: TodoEntry;
  readOnly: boolean;
  onToggle: () => void;
}) {
  const { event, todo } = entry;

  return (
    <li data-testid="trip-todo" data-deadline={todo.deadline ?? ''}>
      <Card className="flex items-start gap-3 p-3 sm:p-4">
        <label className={cn('mt-0.5', readOnly ? 'cursor-default' : 'cursor-pointer')}>
          <span className="sr-only">
            {todo.completed ? 'Mark incomplete' : 'Mark complete'}: {todo.text}
          </span>
          <input
            type="checkbox"
            checked={todo.completed}
            disabled={readOnly}
            onChange={onToggle}
            className="size-4 accent-[var(--accent)] disabled:cursor-not-allowed"
          />
        </label>

        <div className="min-w-0 flex-1">
          <p className={cn('text-sm text-ink', todo.completed && 'text-ink-muted line-through')}>
            {todo.text}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-2xs text-ink-muted">
            <CalendarDays aria-hidden="true" className="size-3" />
            {event.name || 'Unnamed event'}
          </p>
        </div>

        {todo.deadline && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-pending-soft px-2 py-1 text-2xs text-pending-text">
            <CalendarClock aria-hidden="true" className="size-3" />
            {formatTodoDeadline(todo.deadline)}
          </span>
        )}
      </Card>
    </li>
  );
}

function TodoGroup({
  title,
  entries,
  readOnly,
  onToggle,
}: {
  title: string;
  entries: TodoEntry[];
  readOnly: boolean;
  onToggle: (entry: TodoEntry) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm text-ink">{title}</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <TodoRow
            key={`${entry.event.id}:${entry.id}`}
            entry={entry}
            readOnly={readOnly}
            onToggle={() => onToggle(entry)}
          />
        ))}
      </ul>
    </section>
  );
}

export function TripTodos() {
  const { tripId } = useParams<{ tripId: string }>();
  const store = useTripStore(tripId);
  const state = useTripState(store);
  const phone = useMediaQuery(PHONE);
  const doc = state?.doc as TripDoc | undefined;
  const events = useEvents(state);
  const [trip, setTrip] = useState<TripSummary | null>(null);

  const load = useCallback(() => {
    if (!tripId) return;
    void api
      .getTrip(tripId)
      .then(setTrip)
      .catch(() => setTrip(null));
  }, [tripId]);

  useEffect(load, [load]);

  const todos = useMemo(() => eventTodos(events), [events]);
  const dated = todos.filter((entry) => entry.todo.deadline !== undefined);
  const undated = todos.filter((entry) => entry.todo.deadline === undefined);
  const readOnly = trip === null || trip.role === 'viewer';

  function toggle(entry: TodoEntry) {
    store?.change((current) =>
      updateTodo(
        current,
        entry.event.id,
        entry.id,
        { completed: !entry.todo.completed },
        { userId: 'me' },
      ),
    );
  }

  return (
    <TripChrome tripId={tripId ?? ''} tripName={trip?.name ?? doc?.meta?.name ?? 'Trip'}>
      <header className="shrink-0 border-b border-line bg-page/95 backdrop-blur">
        {/*
          A phone keeps the title and whether it is saved. The way to the trip's
          other screens, and the theme, are in the drawer at the bottom edge.
        */}
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {!phone && (
            <Link
              to={`/t/${tripId}`}
              className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
            >
              Itinerary
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg">To-dos</h1>
          {!phone && (
            <Link
              to={`/t/${tripId}/files`}
              className="text-xs text-ink-muted underline-offset-2 hover:underline md:hidden"
            >
              Files
            </Link>
          )}
          <SyncBadge state={state} />
          {!phone && <ThemeToggle />}
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h2 className="mb-1 text-base text-ink">Everything left to do</h2>
          <p className="max-w-prose text-sm text-ink-secondary">
            Deadlines come first, earliest to latest. Work without a date follows.
          </p>
        </div>

        {trip?.role === 'viewer' && (
          <p className="mb-6 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-secondary">
            You can read this trip’s todos. Only an editor can mark them complete.
          </p>
        )}

        {todos.length > 0 ? (
          <div data-testid="trip-todos">
            <TodoGroup title="With deadlines" entries={dated} readOnly={readOnly} onToggle={toggle} />
            <TodoGroup title="No deadline" entries={undated} readOnly={readOnly} onToggle={toggle} />
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-card px-6 py-12 text-center">
            <ListChecks aria-hidden="true" className="mx-auto mb-3 size-7 text-ink-muted" />
            <h2 className="text-sm text-ink">No todos yet</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Add one from an event, and it will appear here.
            </p>
          </div>
        )}
      </main>
    </TripChrome>
  );
}
