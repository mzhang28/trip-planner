import type { TripEvent } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import { eventTodos, formatTodoDeadline } from './todos';

function event(id: string, todos: NonNullable<TripEvent['todos']>): TripEvent {
  return {
    id,
    kind: 'activity',
    name: id,
    booking: { status: 'idea' },
    links: {},
    attachments: {},
    todos,
    customFields: {},
    updatedAt: 1,
    updatedBy: 'me',
  };
}

describe('trip todos', () => {
  it('puts deadlines first in date order, followed by undated work', () => {
    const entries = eventTodos([
      event('flight', {
        later: { text: 'Choose a seat', deadline: '2026-09-10', completed: false, addedAt: 1 },
        someday: { text: 'Download a film', completed: false, addedAt: 2 },
      }),
      event('hotel', {
        sooner: { text: 'Send passport', deadline: '2026-09-02', completed: false, addedAt: 3 },
      }),
    ]);

    expect(entries.map((entry) => entry.todo.text)).toEqual([
      'Send passport',
      'Choose a seat',
      'Download a film',
    ]);
  });

  it('formats a date without shifting it into the device timezone', () => {
    expect(formatTodoDeadline('2026-09-02')).toBe('2 Sept 2026');
  });
});
