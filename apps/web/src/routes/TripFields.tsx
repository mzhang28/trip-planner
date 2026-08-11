import {
  addFieldDef,
  addFieldOption,
  deleteFieldDef,
  liveFieldDefs,
  removeFieldOption,
  updateTripMeta,
  updateFieldDef,
  type FieldDef,
  type FieldType,
  type TripDoc,
} from '@trip/crdt';
import { Button, Card, TextField, ThemeToggle } from '@trip/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { randomId } from '../lib/crypto';
import { api, type TripSummary } from '../lib/api';
import { setDay, toDateInput } from '../lib/time';
import { AuditPanel } from '../trip/AuditPanel';
import { SyncBadge } from '../trip/SyncBadge';
import { useTripState, useTripStore } from '../trip/useTrip';

const TYPES: Array<{ value: FieldType; label: string; hint: string }> = [
  { value: 'text', label: 'Text', hint: 'A short line, like a reservation name' },
  { value: 'longtext', label: 'Long text', hint: 'A paragraph' },
  { value: 'number', label: 'Number', hint: 'With an optional unit' },
  { value: 'money', label: 'Money', hint: 'An amount in one currency' },
  { value: 'date', label: 'Date', hint: 'A day' },
  { value: 'datetime', label: 'Date and time', hint: 'A day and a time' },
  { value: 'url', label: 'Link', hint: 'A web address' },
  { value: 'email', label: 'Email', hint: 'An address to write to' },
  { value: 'phone', label: 'Phone', hint: 'A number to call' },
  { value: 'checkbox', label: 'Yes or no', hint: 'A tick' },
  { value: 'select', label: 'One choice', hint: 'Pick one of a list' },
  { value: 'multiselect', label: 'Several choices', hint: 'Pick any of a list' },
];

/**
 * The fields this trip keeps on its events, beyond the built-in ones.
 *
 * Defined per trip rather than per event, so a field added once is offered
 * everywhere and means the same thing throughout. A trip that needs to track
 * who is driving does it here; one that does not never sees the field.
 */
export function TripFields() {
  const { tripId } = useParams<{ tripId: string }>();
  const store = useTripStore(tripId);
  const state = useTripState(store);

  /*
   * This screen asked nothing about the role and offered every write control to
   * anyone who reached the URL. The server refuses the writes, so nothing was
   * ever changed -- but a viewer could add a field, watch it appear, and find
   * it gone on the next load, which is worse than being told no.
   */
  const [trip, setTrip] = useState<TripSummary | null>(null);

  /*
   * Read-only until the role is known, not until it is known to be viewer.
   * The other way round shows every write control for as long as the request
   * takes, so a viewer sees buttons appear and then vanish.
   */
  const canEdit = trip !== null && trip.role !== 'viewer';
  const readOnly = !canEdit;

  useEffect(() => {
    if (!tripId) return;
    void api
      .getTrip(tripId)
      .then(setTrip)
      .catch(() => setTrip(null));
  }, [tripId]);

  const doc = state?.doc as TripDoc | undefined;
  const defs = useMemo(() => liveFieldDefs(doc), [doc]);
  const homeTimezone = doc?.meta.homeTimezone ?? trip?.homeTimezone ?? 'UTC';
  const tripStart =
    doc?.meta.startsAt === undefined ? '' : toDateInput(doc.meta.startsAt, homeTimezone);
  const tripEnd = doc?.meta.endsAt === undefined ? '' : toDateInput(doc.meta.endsAt, homeTimezone);

  function setTripStart(day: string) {
    if (!store) return;
    if (!day) {
      store.change((current) => updateTripMeta(current, { startsAt: undefined }));
      return;
    }

    const startsAt = setDay(undefined, homeTimezone, day);
    if (startsAt === null) return;
    store.change((current) =>
      updateTripMeta(current, {
        startsAt,
        // Keep the range valid when its beginning moves past its end.
        ...(tripEnd && tripEnd < day ? { endsAt: startsAt } : {}),
      }),
    );
  }

  function setTripEnd(day: string) {
    if (!store) return;
    if (!day) {
      store.change((current) => updateTripMeta(current, { endsAt: undefined }));
      return;
    }

    const endsAt = setDay(undefined, homeTimezone, day);
    if (endsAt === null) return;
    store.change((current) =>
      updateTripMeta(current, {
        endsAt,
        // Likewise, choosing an earlier end brings the start with it.
        ...(tripStart && tripStart > day ? { startsAt: endsAt } : {}),
      }),
    );
  }

  /** How many events would lose something, so a delete can say what it costs. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();

    for (const event of Object.values(doc?.events ?? {})) {
      if (event.deletedAt !== undefined) continue;
      for (const fieldId of Object.keys(event.customFields)) {
        counts.set(fieldId, (counts.get(fieldId) ?? 0) + 1);
      }
    }

    return counts;
  }, [doc]);

  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('text');

  function create() {
    const trimmed = label.trim();
    if (!trimmed || !store) return;

    store.change((current) =>
      addFieldDef(current, {
        id: `f_${randomId()}`,
        label: trimmed,
        type,
        order: defs.length,
      }),
    );
    setLabel('');
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to={`/t/${tripId}`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline"
          >
            Back to trip
          </Link>
          <h1 className="flex-1 text-lg">Trip settings</h1>
          <SyncBadge state={state} />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <h2 className="mb-1 text-sm text-ink">Trip dates</h2>
        <p className="mb-4 max-w-prose text-sm text-ink-secondary">
          The week timeline starts and stops on these days. Both dates are included.
        </p>

        <Card className="mb-10 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
              Trip starts
              <input
                type="date"
                data-testid="trip-start-date"
                value={tripStart}
                disabled={readOnly}
                onChange={(event) => setTripStart(event.currentTarget.value)}
                className="h-9 rounded-md border border-line-input bg-card px-2.5 text-sm text-ink focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-secondary">
              Trip ends
              <input
                type="date"
                data-testid="trip-end-date"
                value={tripEnd}
                disabled={readOnly}
                onChange={(event) => setTripEnd(event.currentTarget.value)}
                className="h-9 rounded-md border border-line-input bg-card px-2.5 text-sm text-ink focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60"
              />
            </label>
          </div>
          <p className="mt-3 text-2xs text-ink-muted">
            Dates use the trip timezone: {homeTimezone}.
          </p>
        </Card>

        <h2 className="mb-1 text-sm text-ink">Custom fields</h2>
        <p className="mb-6 max-w-prose text-sm text-ink-secondary">
          Anything you add here appears on every event in this trip, and is searchable by its name
          as well as its value.
        </p>

        {readOnly && (
          <p className="mb-6 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-secondary">
            You are reading this trip. Only someone who can edit it may change its settings.
          </p>
        )}

        {!readOnly && (
        <Card className="mb-8 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label="Name"
              className="min-w-40 flex-1"
              placeholder="Dress code"
              value={label}
              onChange={setLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-secondary">Holds</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as FieldType)}
                className="h-9 rounded-md border border-line-input bg-card px-2 text-sm text-ink focus:border-accent focus:outline-focus focus:outline-2 focus:-outline-offset-1"
              >
                {TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <Button variant="primary" onPress={create} isDisabled={label.trim() === ''}>
              <Plus className="size-4" />
              Add field
            </Button>
          </div>

          <p className="mt-2 text-2xs text-ink-muted">
            {TYPES.find((option) => option.value === type)?.hint}
          </p>
        </Card>
        )}

        {defs.length === 0 ? (
          <p className="py-6 text-center text-ink-secondary">
            No fields yet. Most trips want one or two — a cost, a dress code, who booked it.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {defs.map((def) => (
              <FieldRow
                key={def.id}
                def={def}
                readOnly={readOnly}
                usedBy={usage.get(def.id) ?? 0}
                onRename={(next) => store?.change((c) => updateFieldDef(c, def.id, { label: next }))}
                onSetUnit={(unit) => store?.change((c) => updateFieldDef(c, def.id, { unit }))}
                onSetCurrency={(currency) =>
                  store?.change((c) => updateFieldDef(c, def.id, { currency }))
                }
                onAddOption={(optionLabel) =>
                  store?.change((c) =>
                    addFieldOption(c, def.id, `o_${randomId()}`, { label: optionLabel }),
                  )
                }
                onRemoveOption={(optionId) =>
                  store?.change((c) => removeFieldOption(c, def.id, optionId))
                }
                onDelete={() => store?.change((c) => deleteFieldDef(c, def.id))}
              />
            ))}
          </div>
        )}
        <div className="mt-12 border-t border-line pt-8">
          {tripId && (
            <AuditPanel
              tripId={tripId}
              // Undo writes to the document on the server, so the local replica
              // has to ask for it rather than wait for something to poke it.
              onUndone={() => void store?.sync()}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function FieldRow({
  def,
  readOnly,
  usedBy,
  onRename,
  onSetUnit,
  onSetCurrency,
  onAddOption,
  onRemoveOption,
  onDelete,
}: {
  def: FieldDef;
  readOnly: boolean;
  usedBy: number;
  onRename: (label: string) => void;
  onSetUnit: (unit: string | undefined) => void;
  onSetCurrency: (currency: string | undefined) => void;
  onAddOption: (label: string) => void;
  onRemoveOption: (optionId: string) => void;
  onDelete: () => void;
}) {
  const [option, setOption] = useState('');
  const isChoice = def.type === 'select' || def.type === 'multiselect';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Name"
          className="min-w-40 flex-1"
          isDisabled={readOnly}
          defaultValue={def.label}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim();
            if (next && next !== def.label) onRename(next);
          }}
        />

        <span className="pb-2 text-2xs text-ink-muted">
          {TYPES.find((t) => t.value === def.type)?.label}
        </span>

        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              /*
               * Named, and counted. Removing a field takes its value off every
               * event that had one, and the number is the only way to know
               * whether that is nothing or a week of work.
               */
              const cost = usedBy === 0 ? '' : ` It is filled in on ${usedBy} event${usedBy === 1 ? '' : 's'}, and those values go with it.`;
              if (confirm(`Delete the field “${def.label}”?${cost}`)) onDelete();
            }}
            className="text-danger"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        )}
      </div>

      {def.type === 'number' && (
        <TextField
          label="Unit"
          className="max-w-40"
          isDisabled={readOnly}
          placeholder="km"
          defaultValue={def.unit ?? ''}
          onBlur={(e) => onSetUnit(e.currentTarget.value.trim() || undefined)}
        />
      )}

      {def.type === 'money' && (
        <TextField
          label="Currency"
          className="max-w-40"
          isDisabled={readOnly}
          placeholder="JPY"
          description="A three-letter code."
          defaultValue={def.currency ?? ''}
          onBlur={(e) => onSetCurrency(e.currentTarget.value.trim().toUpperCase() || undefined)}
        />
      )}

      {isChoice && !readOnly && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-secondary">Choices</span>

          {Object.entries(def.options ?? {}).length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {Object.entries(def.options ?? {}).map(([optionId, opt]) => (
                <li
                  key={optionId}
                  className="flex items-center gap-1 rounded-full border border-line-default px-2 py-0.5 text-xs"
                >
                  {opt.label}
                  <button
                    type="button"
                    aria-label={`Remove ${opt.label}`}
                    onClick={() => onRemoveOption(optionId)}
                    className="text-ink-muted hover:text-danger focus-visible:outline-focus focus-visible:outline-2"
                  >
                    <Trash2 aria-hidden="true" className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <TextField
              label="New choice"
              labelHidden
              className="max-w-52 flex-1"
              placeholder="Add a choice"
              value={option}
              onChange={setOption}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && option.trim()) {
                  onAddOption(option.trim());
                  setOption('');
                }
              }}
            />
            <Button
              size="sm"
              isDisabled={option.trim() === ''}
              onPress={() => {
                onAddOption(option.trim());
                setOption('');
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
