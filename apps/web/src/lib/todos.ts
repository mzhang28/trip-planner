import type { EventTodo, TripEvent } from '@trip/crdt';

export interface TodoEntry {
  event: TripEvent;
  id: string;
  todo: EventTodo;
}

/** All event todos, with dated work first and earliest deadlines first. */
export function eventTodos(events: TripEvent[]): TodoEntry[] {
  return events
    .flatMap((event) =>
      Object.entries(event.todos ?? {}).map(([id, todo]) => ({ event, id, todo })),
    )
    .sort((a, b) => {
      const aDated = a.todo.deadline !== undefined;
      const bDated = b.todo.deadline !== undefined;
      if (aDated !== bDated) return aDated ? -1 : 1;

      const deadline = (a.todo.deadline ?? '').localeCompare(b.todo.deadline ?? '');
      if (deadline !== 0) return deadline;

      if (a.todo.completed !== b.todo.completed) return a.todo.completed ? 1 : -1;
      return a.todo.addedAt - b.todo.addedAt || a.todo.text.localeCompare(b.todo.text);
    });
}

export function formatTodoDeadline(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${day}T12:00:00Z`));
}
