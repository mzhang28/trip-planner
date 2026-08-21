import { useDraggable } from '@dnd-kit/core';
import { cn } from '@trip/ui';
import type { ReactNode } from 'react';

export interface DragHandleProps {
  ref: (element: HTMLElement | null) => void;
  [key: string]: unknown;
}

/**
 * Wraps an event in a drag source, and hands its child the props that start a
 * drag.
 *
 * The child decides what carries them: the tray of undated events puts them on
 * the chip itself, which is also the button that opens the event. A viewer gets
 * `null` instead, and drags nothing.
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
      {children(disabled ? null : { ...attributes, ...listeners, ref: setActivatorNodeRef })}
    </div>
  );
}
