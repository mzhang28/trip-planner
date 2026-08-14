import type {
  BookingStatus,
  CustomValue,
  EditableTodo,
  EventAttachment,
  EventKind,
  FieldDef,
  FieldDefId,
  TransitMethod,
  TripDoc,
  TripEvent,
} from '@trip/crdt';
import { BOOKING_STATUSES } from '@trip/crdt';
import {
  BOOKING_STATUS_LABEL,
  Card,
  ColorPicker,
  StatusChip,
  StatusSpine,
  cn,
  coloredSurfaceStyle,
} from '@trip/ui';
import { FileText, Paperclip } from 'lucide-react';
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { formatTime, usesTwelveHourClock } from '../lib/time';
import { useDisplayZone } from './useDisplayZone';
import { EventDetails } from './EventDetails';
import { EventEditor } from './EventEditor';
import { EVENT_KIND_LABEL, EVENT_KIND_OPTIONS, EventKindIcon } from './EventKind';
import { JourneySummary } from './FlightFields';

/**
 * The width of the time down the left of every row.
 *
 * One width for the whole list, so the names beside the times start on the same
 * line rather than stepping in and out with the length of each clock. A
 * twelve-hour reading carries AM or PM and needs the wider of the two.
 */
const TIME_COLUMN = usesTwelveHourClock() ? 'w-16' : 'w-11';

export interface EventRowProps {
  event: TripEvent;
  homeTimezone: string;
  fieldDefs: FieldDef[];
  readOnly: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onAddLink: (url: string, title: string | undefined) => void;
  onRemoveLink: (linkId: string) => void;
  onSetCustomField: (fieldId: FieldDefId, value: CustomValue | undefined) => void;
  onSetCityColor: (city: string, color: string | undefined) => void;
  onAddAttachment: (id: string, attachment: EventAttachment) => void;
  onRemoveAttachment: (id: string) => void;
  onAddTodo: (text: string, deadline: string | undefined) => void;
  onUpdateTodo: (id: string, patch: Partial<EditableTodo>) => void;
  onRemoveTodo: (id: string) => void;
  onDelete: () => void;
  doc: TripDoc | undefined;
  onOpenEvent: (eventId: string) => void;
  /**
   * Held by the list rather than by the card.
   *
   * Setting a time moves the event to another day, which re-parents the card
   * and would reset state living here -- so the editor would snap shut at the
   * moment someone finished typing into it.
   */
  isOpen: boolean;
  onToggle: () => void;
  /** Fields asked for during this sitting, held by the list for the same reason. */
  revealed: ReadonlySet<string>;
  onReveal: (key: string) => void;
  /** Takes a field off the event, with what it holds. Undo is offered after. */
  onRemoveField: (key: string, label: string) => void;
  isSelected: boolean;
  onToggleSelected: () => void;
  /** Once anything is ticked, every card shows its box. */
  selectionActive: boolean;
  /** Rendered as the grip. Absent for a viewer, who cannot move anything. */
  dragHandle?: ReactNode;
}

function EventContentIndicators({ event }: { event: TripEvent }) {
  const attachmentCount = Object.keys(event.attachments).length;
  const hasDescription = Boolean(event.description?.trim());

  if (attachmentCount === 0 && !hasDescription) return null;

  return (
    <span className="flex shrink-0 items-center gap-1 text-ink-muted">
      {attachmentCount > 0 && (
        <span
          data-testid="attachment-indicator"
          title={`${attachmentCount} attached file${attachmentCount === 1 ? '' : 's'}`}
          className="inline-flex"
        >
          <Paperclip aria-hidden="true" className="size-3.5" />
          <span className="sr-only">
            {attachmentCount} attached file{attachmentCount === 1 ? '' : 's'}
          </span>
        </span>
      )}
      {hasDescription && (
        <span
          data-testid="description-indicator"
          title="Has description"
          className="inline-flex"
        >
          <FileText aria-hidden="true" className="size-3.5" />
          <span className="sr-only">Has description</span>
        </span>
      )}
    </span>
  );
}

function EventKindPicker({
  kind,
  method,
  onChange,
}: {
  kind: EventKind;
  method?: TransitMethod;
  onChange: (kind: EventKind) => void;
}) {
  return (
    <DialogTrigger>
      <Button
        data-testid="event-kind-button"
        aria-label={`Change kind, currently ${EVENT_KIND_LABEL[kind]}`}
        className={cn(
          'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-secondary',
          'data-hovered:bg-sunken data-hovered:text-ink data-pressed:bg-sunken',
          'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:outline-offset-1',
        )}
      >
        <EventKindIcon kind={kind} method={method} className="size-5" />
      </Button>

      <Popover
        placement="bottom start"
        className="rounded-lg border border-line-default bg-card p-1 shadow-lg outline-none"
      >
        <Dialog aria-label="Event kind" className="outline-none">
          {({ close }) => (
            <div className="grid grid-cols-4 gap-1">
              {EVENT_KIND_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  aria-label={option.label}
                  aria-pressed={kind === option.value}
                  onPress={() => {
                    onChange(option.value);
                    close();
                  }}
                  className={cn(
                    'flex min-w-14 cursor-pointer flex-col items-center gap-1 rounded-md px-2 py-2 text-2xs text-ink-secondary',
                    'data-hovered:bg-sunken data-hovered:text-ink data-pressed:bg-sunken',
                    'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:-outline-offset-1',
                    kind === option.value && 'bg-accent-soft text-accent-strong',
                  )}
                >
                  <EventKindIcon kind={option.value} className="size-5" />
                  {option.label}
                </Button>
              ))}
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function BookingStatusPicker({
  status,
  onChange,
  className,
}: {
  status: BookingStatus;
  onChange: (status: BookingStatus) => void;
  className?: string;
}) {
  return (
    <DialogTrigger>
      <Button
        data-testid="booking-status-button"
        aria-label={`Change booking status, currently ${BOOKING_STATUS_LABEL[status]}`}
        className={cn(
          'cursor-pointer rounded-sm',
          'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
          className,
        )}
      >
        <StatusChip status={status} className="pointer-events-none" />
      </Button>

      <Popover
        placement="bottom end"
        className="rounded-lg border border-line-default bg-card p-1 shadow-lg outline-none"
      >
        <Dialog aria-label="Booking status" className="outline-none">
          {({ close }) => (
            <div className="flex min-w-40 flex-col gap-1">
              {BOOKING_STATUSES.map((option) => (
                <Button
                  key={option}
                  aria-label={BOOKING_STATUS_LABEL[option]}
                  aria-pressed={status === option}
                  onPress={() => {
                    onChange(option);
                    close();
                  }}
                  className={cn(
                    'flex cursor-pointer items-center rounded-md px-2 py-1.5 text-left',
                    'data-hovered:bg-sunken data-pressed:bg-sunken',
                    'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:-outline-offset-1',
                    status === option && 'bg-sunken',
                  )}
                >
                  <StatusChip status={option} className="pointer-events-none" />
                </Button>
              ))}
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function InlineEventName({
  value,
  onCommit,
  startEditing = false,
}: {
  value: string;
  onCommit: (name: string) => void;
  startEditing?: boolean;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(value === '' || startEditing);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
    if (value === '') setEditing(true);
  }, [value]);

  function commit() {
    const name = draft.trim();
    if (name === '' && value !== '') {
      setError('An event needs a name.');
      return;
    }

    setError(null);
    if (name !== value) onCommit(name);
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        data-testid="event-name"
        aria-label={`Edit name: ${value || 'Unnamed'}`}
        title="Double-click to edit"
        onDoubleClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') setEditing(true);
        }}
        className={cn(
          'flex h-8 min-w-0 flex-1 cursor-text items-center truncate rounded-sm px-2 text-sm font-medium',
          'focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-1',
          value ? 'text-ink' : 'text-ink-placeholder italic',
        )}
      >
        {value || 'Unnamed'}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <input
        aria-label="Name"
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        autoFocus={value === ''}
        value={draft}
        placeholder="What is it?"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            setError(null);
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
        className={cn(
          'h-8 min-w-0 w-full rounded-md border bg-transparent px-2 text-sm font-medium text-ink',
          'placeholder:text-ink-placeholder placeholder:italic',
          'hover:border-line-input focus:bg-card focus:outline-focus focus:outline-2 focus:-outline-offset-1',
          error ? 'border-danger' : 'border-transparent focus:border-accent',
        )}
      />
      {error && (
        <span id={errorId} className="px-2 text-2xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * One event, which opens in place when clicked.
 *
 * Editing happens on the card rather than in a dialog. Most edits here are one
 * field -- a time, a status -- and sending someone to another surface and back
 * for that costs more attention than the edit does.
 */
export function EventRow({
  event,
  homeTimezone,
  fieldDefs,
  readOnly,
  onPatch,
  onAddLink,
  onRemoveLink,
  onSetCustomField,
  onSetCityColor,
  onAddAttachment,
  onRemoveAttachment,
  onAddTodo,
  onUpdateTodo,
  onRemoveTodo,
  onDelete,
  doc,
  onOpenEvent,
  isOpen,
  revealed,
  onReveal,
  onRemoveField,
  onToggle,
  isSelected,
  onToggleSelected,
  selectionActive,
  dragHandle,
}: EventRowProps) {
  const displayZone = useDisplayZone();
  const zone = displayZone(event.timezone, homeTimezone);
  // An event on a day with no hour yet reads the same as one with no day: the
  // card says nothing about when, and the day it sits under says the rest.
  const time =
    event.startsAt === undefined || event.timeUndecided ? null : formatTime(event.startsAt, zone);

  const linkCount = Object.keys(event.links).length;
  const summary = [
    event.kind === 'transit' ? event.transit?.fromCity ?? event.city : event.city,
    event.location?.label,
    linkCount > 0 ? `${linkCount} link${linkCount === 1 ? '' : 's'}` : undefined,
  ].filter(Boolean);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openForNameEdit, setOpenForNameEdit] = useState(false);

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  function openFromClick(click: MouseEvent) {
    // Hold a pointer's first click briefly so a second click can mean inline
    // name editing without opening and replacing the row between clicks.
    if (click.detail === 1) {
      openTimer.current = setTimeout(() => {
        setOpenForNameEdit(false);
        onToggle();
        openTimer.current = null;
      }, 200);
      return;
    }

    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }

    const onTheName =
      click.detail === 2 &&
      (click.target as HTMLElement).closest('[data-testid="event-name"]') !== null;

    setOpenForNameEdit(onTheName);

    /*
     * A double click on the name means "edit this", never "close this". It used
     * to toggle as well, so a card that was already open shut underneath the
     * name field it had just been asked to show -- and with the first click's
     * timer still to fire, the card went on opening and closing after that.
     */
    if (!(onTheName && isOpen)) onToggle();
  }

  return (
    /*
     * Clipped while closed, so the status spine stops at the rounded corner.
     * Open, the clip has to go: it is the box a sticky footer sticks inside,
     * and a card taller than the screen would pin Done to the card's own
     * bottom edge -- which is exactly the part that is off screen.
     */
    <Card
      className={cn(
        // The spine's own strip, kept clear of everything else. Laid over the
        // card without it, the mark sat inside the padding of whatever it
        // crossed -- the editor's fields had four of their twelve pixels of
        // gutter taken away and read as pressed against the edge.
        'relative pl-1',
        isOpen ? 'overflow-visible' : 'overflow-hidden',
      )}
    >
      {/*
        Laid over the card rather than sitting in the header row.

        As a flex child of the header it was only as tall as the header, so a
        transit card -- which carries its journey summary underneath -- had a
        spine down two thirds of it and bare card below. The status belongs to
        the whole event, so the mark runs the whole height whatever the card
        has grown to hold.
      */}
      <span
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
        style={{ borderRadius: 'inherit' }}
      >
        <StatusSpine status={event.booking.status} className="absolute inset-y-0 left-0" />
      </span>

      <div
        className={cn(
          'event-row-header group/event-row flex transition-colors duration-100',
          isOpen && 'rounded-t-lg',
        )}
        style={coloredSurfaceStyle(event.color)}
      >

        {!readOnly && (
          <label
            className={cn(
              'flex cursor-pointer items-center pl-2',
              /*
               * Hidden until something is ticked or the card is hovered, so a
               * list of events is a list of events rather than a form -- but
               * only where hovering is a thing. A finger has no hover, so on a
               * phone the boxes were invisible and selection unreachable.
               */
              !selectionActive &&
                !isSelected &&
                '[@media(hover:hover)]:opacity-0 focus-within:opacity-100 group-hover/event-row:opacity-100',
            )}
          >
            <span className="sr-only">Select {event.name}</span>
            <input
              type="checkbox"
              data-testid="event-select"
              checked={isSelected}
              onChange={onToggleSelected}
              className="size-4 accent-[var(--accent)]"
            />
          </label>
        )}

        {dragHandle}

        {isOpen && !readOnly ? (
          <div data-testid="event" className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
            {/* Keeps row lookup and announcements useful while the visible name is an input. */}
            <span className="sr-only">{event.name || 'Unnamed'}</span>
            <span className={cn('tabular shrink-0 text-xs text-ink-muted', TIME_COLUMN)}>
              {time ?? '--:--'}
            </span>
            <EventKindPicker
              kind={event.kind}
              method={event.transit?.method}
              onChange={(kind) => onPatch({ kind })}
            />
            <ColorPicker
              value={event.color}
              label={`Color for ${event.name || 'this event'}`}
              onChange={(color) => onPatch({ color })}
            />
            <InlineEventName
              value={event.name}
              startEditing={openForNameEdit}
              onCommit={(name) => onPatch({ name })}
            />
            <EventContentIndicators event={event} />
            <BookingStatusPicker
              status={event.booking.status}
              onChange={(status) => onPatch({ booking: { ...event.booking, status } })}
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1">
            <Button
              data-testid="event"
              onClick={openFromClick}
              aria-expanded={isOpen}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left',
                'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:-outline-offset-2',
              )}
            >
              <span className={cn('tabular shrink-0 text-xs text-ink-muted', TIME_COLUMN)}>
                {time ?? '--:--'}
              </span>

              <span className="min-w-0 flex-1">
                {/* An event made by picking a day is real before it is named. */}
                <span className="flex min-w-0 items-center gap-1.5">
                  <EventKindIcon
                    kind={event.kind}
                    method={event.transit?.method}
                    className="size-3.5 shrink-0 text-ink-muted"
                  />
                  <span
                    data-testid="event-name"
                    className={cn(
                      'truncate text-sm font-medium',
                      event.name ? 'text-ink' : 'text-ink-placeholder italic',
                    )}
                  >
                    {event.name || 'Unnamed'}
                  </span>
                  <EventContentIndicators event={event} />
                </span>
                {summary.length > 0 && (
                  <span className="block truncate text-2xs text-ink-muted">
                    {summary.join(' · ')}
                  </span>
                )}
              </span>
            </Button>

            {!readOnly ? (
              <BookingStatusPicker
                status={event.booking.status}
                onChange={(status) => onPatch({ booking: { ...event.booking, status } })}
                className="mr-3 self-center"
              />
            ) : (
              <StatusChip status={event.booking.status} className="mr-3 self-center" />
            )}
          </div>
        )}
      </div>

      {event.kind === 'transit' && (
        <div className="px-3 pb-2">
          <JourneySummary event={event} homeTimezone={homeTimezone} />
        </div>
      )}

      {isOpen && readOnly && (
        <EventDetails
          event={event}
          homeTimezone={homeTimezone}
          zone={zone}
          fieldDefs={fieldDefs}
          cityColors={doc?.cityColors}
          doc={doc}
          onOpenEvent={onOpenEvent}
        />
      )}

      {isOpen && !readOnly && (
        <EventEditor
          event={event}
          homeTimezone={homeTimezone}
          fieldDefs={fieldDefs}
          onPatch={onPatch}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onSetCustomField={onSetCustomField}
          onSetCityColor={onSetCityColor}
          onAddAttachment={onAddAttachment}
          onRemoveAttachment={onRemoveAttachment}
          onAddTodo={onAddTodo}
          onUpdateTodo={onUpdateTodo}
          onRemoveTodo={onRemoveTodo}
          onDelete={onDelete}
          doc={doc}
          onOpenEvent={onOpenEvent}
          onClose={onToggle}
          revealed={revealed}
          onReveal={onReveal}
          onRemoveField={onRemoveField}
        />
      )}
    </Card>
  );
}
