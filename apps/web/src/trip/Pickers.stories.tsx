import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Place } from '@trip/crdt';
import { useState } from 'react';
import { clockExample } from '../lib/time';
import { HOME_TIMEZONE, TOKYO } from '../stories/japan';
import { Example } from '../stories/harness';
import { AirportPicker } from './AirportPicker';
import { CheckedField } from './CheckedField';
import { PlacePicker } from './PlacePicker';
import { TimeField } from './TimeField';
import { TimezonePicker } from './TimezonePicker';

/**
 * The fields that go and ask something before they can answer.
 *
 * All four are typed into first and looked up second, because a field that can
 * only be answered by pointing cannot be answered at all by somebody with a
 * phone keyboard and a friend's address that no map has heard of. Whatever is
 * typed is kept; the lookup only offers to fill in the rest.
 *
 * The searches here are answered by the stubbed server: try `fushimi`, `ueno`
 * or `palo` for places, and `NRT`, `tokyo` or `bos` for airports.
 */
const meta = {
  title: 'Fields/Lookups',
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Place_: Story = {
  name: 'Place',
  render: function Places() {
    const [empty, setEmpty] = useState<Place | undefined>(undefined);
    const [filled, setFilled] = useState<Place | undefined>({
      label: 'Arashiyama',
      address: 'Ukyo Ward, Kyoto, Kyoto Prefecture',
      lat: 35.0175,
      lng: 135.6717,
    });
    const [written, setWritten] = useState<Place | undefined>({
      label: "Jasmine's parents' flat",
    });

    return (
      <div className="flex max-w-md flex-col gap-8">
        <Example title="Empty">
          <PlacePicker value={empty} onChange={setEmpty} />
        </Example>
        <Example title="Found, with coordinates">
          <PlacePicker value={filled} onChange={setFilled} />
        </Example>
        <Example title="Written down, which no map knows">
          <PlacePicker value={written} onChange={setWritten} />
        </Example>
      </div>
    );
  },
};

export const Airport: Story = {
  render: function Airports() {
    const [from, setFrom] = useState<{ code?: string; timezone?: string; city?: string }>({
      code: 'SFO',
      timezone: 'America/Los_Angeles',
      city: 'San Francisco',
    });
    const [to, setTo] = useState<{ code?: string; timezone?: string; city?: string }>({});

    return (
      <div className="flex max-w-md flex-col gap-8">
        <Example title="Resolved from a ticket">
          <AirportPicker
            label="From"
            code={from.code}
            city={from.city}
            timezone={from.timezone ?? HOME_TIMEZONE}
            onChange={setFrom}
          />
        </Example>
        <Example title="Empty — type three letters">
          <AirportPicker
            label="To"
            code={to.code}
            city={to.city}
            timezone={to.timezone ?? HOME_TIMEZONE}
            onChange={setTo}
          />
        </Example>
      </div>
    );
  },
};

/** A time and the zone it is on, which on this trip is rarely the home one. */
export const Time: Story = {
  render: function Times() {
    const [value, setValue] = useState('16:30');
    const [zone, setZone] = useState(TOKYO);

    return (
      <div className="flex max-w-md flex-col gap-8">
        <Example title="A time with its zone attached">
          <TimeField
            label="Starts"
            value={value}
            timezone={zone}
            timezoneLabel="Time zone"
            onTimezoneChange={setZone}
            onCommit={(next) => {
              setValue(next);
              return null;
            }}
          />
        </Example>

        <Example title="Rejecting what is not a time">
          <TimeField
            label="Starts"
            value="25:00"
            hint={`A time like ${clockExample(9, 30)}`}
            onCommit={() => 'That is not a time of day.'}
          />
        </Example>

        <Example title="The zone control on its own">
          <div className="flex items-center gap-2">
            <TimezonePicker value={zone} label="Time zone" onChange={setZone} />
            <span className="text-sm text-ink-secondary">{zone}</span>
          </div>
        </Example>
      </div>
    );
  },
};

/** A field that checks what was typed and says so in place. */
export const Checked: Story = {
  render: function Checked() {
    const [code, setCode] = useState('JP-88214');

    return (
      <div className="flex max-w-md flex-col gap-8">
        <Example title="Accepted">
          <CheckedField
            label="Confirmation code"
            value={code}
            hint="From the booking email."
            onCommit={(next) => {
              setCode(next);
              return null;
            }}
          />
        </Example>
        <Example title="Refused, with the reason where the value is">
          <CheckedField
            label="Cost per person"
            value="a lot"
            inputMode="numeric"
            onCommit={() => 'Give this as a number of yen.'}
          />
        </Example>
      </div>
    );
  },
};
