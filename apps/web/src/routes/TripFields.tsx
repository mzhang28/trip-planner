import {
  addFieldDef,
  addFieldOption,
  deleteFieldDef,
  liveFieldDefs,
  removeFieldOption,
  updateFieldDef,
  type FieldDef,
  type FieldType,
  type TripDoc,
} from '@trip/crdt';
import { Button, Card, TextField, ThemeToggle } from '@trip/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
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

  const doc = state?.doc as TripDoc | undefined;
  const defs = useMemo(() => liveFieldDefs(doc), [doc]);

  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('text');

  function create() {
    const trimmed = label.trim();
    if (!trimmed || !store) return;

    store.change((current) =>
      addFieldDef(current, {
        id: `f_${crypto.randomUUID()}`,
        label: trimmed,
        type,
        order: defs.length,
      }),
    );
    setLabel('');
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to={`/t/${tripId}`}
            className="text-xs text-ink-muted underline-offset-2 hover:underline"
          >
            Back to trip
          </Link>
          <h1 className="flex-1 text-lg">Fields</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <p className="mb-6 max-w-prose text-sm text-ink-secondary">
          Anything you add here appears on every event in this trip, and is searchable by its name
          as well as its value.
        </p>

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
                onRename={(next) => store?.change((c) => updateFieldDef(c, def.id, { label: next }))}
                onSetUnit={(unit) => store?.change((c) => updateFieldDef(c, def.id, { unit }))}
                onSetCurrency={(currency) =>
                  store?.change((c) => updateFieldDef(c, def.id, { currency }))
                }
                onAddOption={(optionLabel) =>
                  store?.change((c) =>
                    addFieldOption(c, def.id, `o_${crypto.randomUUID()}`, { label: optionLabel }),
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
      </main>
    </div>
  );
}

function FieldRow({
  def,
  onRename,
  onSetUnit,
  onSetCurrency,
  onAddOption,
  onRemoveOption,
  onDelete,
}: {
  def: FieldDef;
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
          defaultValue={def.label}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim();
            if (next && next !== def.label) onRename(next);
          }}
        />

        <span className="pb-2 text-2xs text-ink-muted">
          {TYPES.find((t) => t.value === def.type)?.label}
        </span>

        <Button variant="ghost" size="sm" onPress={onDelete} className="text-danger">
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      {def.type === 'number' && (
        <TextField
          label="Unit"
          className="max-w-40"
          placeholder="km"
          defaultValue={def.unit ?? ''}
          onBlur={(e) => onSetUnit(e.currentTarget.value.trim() || undefined)}
        />
      )}

      {def.type === 'money' && (
        <TextField
          label="Currency"
          className="max-w-40"
          placeholder="JPY"
          description="A three-letter code."
          defaultValue={def.currency ?? ''}
          onBlur={(e) => onSetCurrency(e.currentTarget.value.trim().toUpperCase() || undefined)}
        />
      )}

      {isChoice && (
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
