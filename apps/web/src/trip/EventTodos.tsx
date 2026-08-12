import type { EditableTodo, EventTodo } from '@trip/crdt';
import { Button, cn } from '@trip/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

export function EventTodos({
  todos,
  onAdd,
  onUpdate,
  onRemove,
}: {
  todos: Record<string, EventTodo>;
  onAdd: (text: string, deadline: string | undefined) => void;
  onUpdate: (id: string, patch: Partial<EditableTodo>) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [deadline, setDeadline] = useState('');
  const entries = Object.entries(todos).sort(([, a], [, b]) => a.addedAt - b.addedAt);

  function add() {
    const trimmed = text.trim();
    if (!trimmed) return;

    onAdd(trimmed, deadline || undefined);
    setText('');
    setDeadline('');
  }

  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs font-medium text-ink-secondary">To-dos</span>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {entries.map(([id, todo]) => (
            <li key={id} className="flex flex-wrap items-center gap-2 rounded-md bg-sunken px-2 py-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <label>
                  <span className="sr-only">
                    {todo.completed ? 'Mark incomplete' : 'Mark complete'}: {todo.text}
                  </span>
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={(event) => onUpdate(id, { completed: event.currentTarget.checked })}
                    className="size-4 shrink-0 accent-[var(--accent)]"
                  />
                </label>
                <input
                  key={todo.text}
                  aria-label={`Todo: ${todo.text}`}
                  defaultValue={todo.text}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim();
                    if (!next) event.currentTarget.value = todo.text;
                    else if (next !== todo.text) onUpdate(id, { text: next });
                  }}
                  className={cn(
                    'h-7 min-w-32 flex-1 rounded-sm border border-transparent bg-transparent px-1 text-xs text-ink',
                    'hover:border-line-input focus:border-accent focus:bg-card focus:outline-focus focus:outline-2 focus:-outline-offset-1',
                    todo.completed && 'text-ink-muted line-through',
                  )}
                />
              </div>

              <label className="flex items-center gap-1.5 text-2xs text-ink-muted">
                <span>Deadline</span>
                <input
                  type="date"
                  aria-label={`Deadline for ${todo.text}`}
                  value={todo.deadline ?? ''}
                  onChange={(event) =>
                    onUpdate(id, { deadline: event.currentTarget.value || undefined })
                  }
                  className="h-7 rounded-sm border border-line-input bg-card px-1.5 text-2xs text-ink focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1"
                />
              </label>

              <button
                type="button"
                aria-label={`Remove todo: ${todo.text}`}
                onClick={() => onRemove(id)}
                className="text-ink-muted hover:text-danger focus-visible:outline-focus focus-visible:outline-2"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        data-testid="add-todo-form"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label className="min-w-48 flex-1 text-2xs font-medium text-ink-secondary">
          New todo
          <input
            value={text}
            placeholder="Book the airport transfer"
            onChange={(event) => setText(event.currentTarget.value)}
            className="mt-1 h-9 w-full rounded-md border border-line-input bg-card px-2.5 text-sm text-ink placeholder:text-ink-placeholder focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1"
          />
        </label>
        <label className="text-2xs font-medium text-ink-secondary">
          Deadline
          <input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.currentTarget.value)}
            className="mt-1 block h-9 rounded-md border border-line-input bg-card px-2.5 text-sm text-ink focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1"
          />
        </label>
        <Button type="submit" size="sm" isDisabled={!text.trim()} className="mb-1">
          <Plus aria-hidden="true" className="size-3.5" />
          Add todo
        </Button>
      </form>
    </section>
  );
}
