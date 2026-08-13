import type { CustomValue, FieldDef } from '@trip/crdt';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ColorPicker } from './ColorPicker';
import { CustomFieldInput } from './CustomFieldInput';

/**
 * A field somebody invented, and the control that goes with whatever they said
 * it holds.
 *
 * A trip needs fields nobody could have anticipated — cost per person, who
 * booked it, how far it is from the station — so the trip defines them once and
 * every event is offered them. The value carries its own kind, which is what
 * makes retyping a field safe: a number under a field now called a date shows
 * as needing attention rather than as a plausible wrong date.
 */
const meta = {
  title: 'Components/Custom fields',
} satisfies Meta;

export default meta;
type Story = StoryObj;

const DEFS: FieldDef[] = [
  { id: 'f_text', label: 'Booking reference', type: 'text', order: 0 },
  { id: 'f_long', label: 'How to get in', type: 'longtext', order: 1 },
  { id: 'f_number', label: 'Walk from station', type: 'number', unit: 'min', order: 2 },
  { id: 'f_money', label: 'Cost per person', type: 'money', currency: 'JPY', order: 3 },
  { id: 'f_date', label: 'Book by', type: 'date', order: 4 },
  { id: 'f_url', label: 'Booking page', type: 'url', order: 5 },
  { id: 'f_check', label: 'Needs booking', type: 'checkbox', order: 6 },
  {
    id: 'f_select',
    label: 'Booked by',
    type: 'select',
    order: 7,
    options: {
      o_m: { label: 'Michael', color: '#6366f1' },
      o_j: { label: 'Jasmine', color: '#ec4899' },
      o_n: { label: 'Nobody yet', color: '#a3a3a3' },
    },
  },
  {
    id: 'f_multi',
    label: 'Bring',
    type: 'multiselect',
    order: 8,
    options: {
      o_cash: { label: 'Cash', color: '#059669' },
      o_passport: { label: 'Passport', color: '#0284c7' },
      o_shoes: { label: 'Shoes you can take off', color: '#d97706' },
    },
  },
];

const FILLED: Record<string, CustomValue> = {
  f_text: { kind: 'text', text: 'JP-88214' },
  f_long: { kind: 'text', text: 'Keypad by the side door. Code is the last four of the booking.' },
  f_number: { kind: 'number', number: 12 },
  f_money: { kind: 'number', number: 41_000 },
  f_date: { kind: 'instant', at: Date.parse('2026-04-20T00:00:00Z') },
  f_url: { kind: 'text', text: 'https://www.teamlab.art/e/borderless-azabudai/' },
  f_check: { kind: 'bool', bool: true },
  f_select: { kind: 'options', selected: { o_m: true } },
  f_multi: { kind: 'options', selected: { o_cash: true, o_shoes: true } },
};

function Fields({ initial }: { initial: Record<string, CustomValue> }) {
  const [values, setValues] = useState(initial);

  return (
    <div className="flex max-w-sm flex-col gap-5">
      {DEFS.map((def) => (
        <CustomFieldInput
          key={def.id}
          def={def}
          value={values[def.id]}
          onChange={(value) =>
            setValues((was) => {
              const next = { ...was };
              if (value === undefined) delete next[def.id];
              else next[def.id] = value;
              return next;
            })
          }
        />
      ))}
    </div>
  );
}

/** Every type, answered. */
export const Filled: Story = {
  render: () => <Fields initial={FILLED} />,
};

/** Every type, empty — which is how a field arrives on an event. */
export const Empty: Story = {
  render: () => <Fields initial={{}} />,
};

/**
 * A value that no longer matches its field.
 *
 * Somebody retyped "Cost per person" from money to date after the numbers were
 * in. The value says what it is instead of being rendered as a date nobody
 * entered.
 */
export const Mismatched: Story = {
  render: () => (
    <div className="max-w-sm">
      <CustomFieldInput
        def={{ id: 'f_money', label: 'Cost per person', type: 'date', order: 0 }}
        value={{ kind: 'number', number: 41_000 }}
        onChange={() => {}}
      />
    </div>
  ),
};

/** Disabled, which is every field on a trip somebody may only read. */
export const ReadOnly: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-5">
      {DEFS.slice(0, 4).map((def) => (
        <CustomFieldInput
          key={def.id}
          def={def}
          value={FILLED[def.id]}
          onChange={() => {}}
          isDisabled
        />
      ))}
    </div>
  ),
};

/**
 * The colour attached to a select option or a city. A fixed palette rather
 * than a colour wheel: every one of these has to stay legible under its own
 * text in both themes, which a free choice cannot promise.
 */
export const Colours: Story = {
  render: function Colours() {
    const [city, setCity] = useState<string | undefined>('#e11d48');
    const [none, setNone] = useState<string | undefined>(undefined);

    return (
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <ColorPicker value={city} onChange={setCity} label="Colour for Tokyo" />
          <span className="text-sm text-ink">Tokyo</span>
        </div>
        <div className="flex items-center gap-2">
          <ColorPicker value={none} onChange={setNone} label="Colour for Kyoto" />
          <span className="text-sm text-ink">Kyoto</span>
        </div>
      </div>
    );
  },
};
