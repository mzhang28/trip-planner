import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@trip/ui';
import type { ReactNode } from 'react';

/**
 * A day that an event can be dropped onto.
 *
 * Highlighted only while something is over it, so the outline appears when it
 * means something rather than sitting on the page.
 */
export function DayDropZone({
  dayKey,
  disabled,
  children,
}: {
  dayKey: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}`, disabled });

  return (
    <div
      ref={setNodeRef}
      data-testid={`day-${dayKey}`}
      className={cn(
        'rounded-lg transition-colors duration-100',
        isOver && 'bg-accent-soft ring-2 ring-accent',
      )}
    >
      {children}
    </div>
  );
}

export interface DragHandleProps {
  ref: (element: HTMLElement | null) => void;
  [key: string]: unknown;
}

/**
 * Makes an event draggable by a handle rather than by its whole body.
 *
 * The alternative — dragging anywhere on the card — needs a distance threshold
 * to tell a drag from a click, which is a guess that is wrong some of the time
 * on a touch screen. It also puts a second `role="button"` around a card that
 * already has one, so a screen reader announces every event twice.
 *
 * A handle avoids both. The card opens when pressed, the handle moves it, and
 * each does exactly one thing.
 */
export function DraggableEvent({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: DragHandleProps | null) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id,
    disabled,
  });

  return (
    <div ref={setNodeRef} className={cn(isDragging && 'opacity-40')}>
      {children(
        disabled ? null : { ...attributes, ...listeners, ref: setActivatorNodeRef },
      )}
    </div>
  );
}
