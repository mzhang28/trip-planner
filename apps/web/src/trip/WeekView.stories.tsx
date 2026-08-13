import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { addEvent, liveEvents, updateEvent, type Doc, type EventKind } from '@trip/crdt';
import {
  CITY_COLORS,
  HOME_TIMEZONE,
  TODAY,
  TRIP_END,
  TRIP_START,
  japanWeather,
} from '../stories/japan';
import { Frame, STORY_AUTHOR, useTrip } from '../stories/harness';
import { daySlots } from '../lib/dayZones';
import { daysInRange } from '../lib/calendar';
import { setDay, setTimeOfDay } from '../lib/time';
import { WeekView } from './WeekView';

/** A new event, the way the route makes one before filling anything in. */
function created(doc: Doc, id: string, name: string, kind: EventKind = 'activity'): Doc {
  return addEvent(doc, { id, name, kind }, STORY_AUTHOR);
}

/** Minutes past midnight as the `HH:MM` the time helpers read. */
function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Seven days as a timetable, each drawn on the clock it is lived on.
 *
 * The hours down the side belong to a run of days rather than to the week, so
 * a week that crosses the Pacific gets one rail per zone and each sticks while
 * its own days are on screen. Cards can be dragged to another half hour or
 * another day; dragging an empty column makes an event over the hours drawn.
 */
const meta = {
  title: 'Calendar/Week',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'One scroll container carries both axes, which is what lets the hour rails stick: a sticky element resolves against its scrolling ancestor, so a timetable with its own vertical scroller could never stick sideways.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Week({
  anchor,
  readOnly = false,
  height = 620,
}: {
  anchor: string;
  readOnly?: boolean;
  height?: number;
}) {
  const trip = useTrip();
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const events = liveEvents(trip.doc);
  const slots = daySlots(daysInRange(TRIP_START, TRIP_END), events, HOME_TIMEZONE, overrides);

  return (
    <Frame height={height}>
      <WeekView
        anchor={anchor}
        tripStart={TRIP_START}
        tripEnd={TRIP_END}
        events={events}
        cityColors={CITY_COLORS}
        homeTimezone={HOME_TIMEZONE}
        slots={slots}
        weather={japanWeather()}
        today={TODAY}
        readOnly={readOnly}
        onSetDayZone={(day, timezone) =>
          setOverrides((was) => {
            const next = { ...was };
            if (timezone === undefined) delete next[day];
            else next[day] = timezone;
            return next;
          })
        }
        onOpenEvent={() => {}}
        onCreateAt={(day, name, startMinutes) => {
          const id = `e_new_${Date.now()}`;
          const zone = slots.find((slot) => slot.day === day)?.zone ?? HOME_TIMEZONE;
          const midnight = setDay(undefined, zone, day);
          const at =
            startMinutes === undefined || midnight === null
              ? null
              : setTimeOfDay(midnight, zone, clockOf(startMinutes));

          trip.apply((doc) =>
            updateEvent(
              created(doc, id, name),
              id,
              {
                startsAt: at ?? midnight ?? undefined,
                timezone: zone,
                timeUndecided: at === null,
                durationMinutes: 60,
              },
              STORY_AUTHOR,
            ),
          );
        }}
        onCreateLodging={(from, to, name) => {
          const id = `e_stay_${Date.now()}`;
          const zone = slots.find((slot) => slot.day === from)?.zone ?? HOME_TIMEZONE;
          const nights = daysInRange(from, to).length;

          trip.apply((doc) =>
            updateEvent(
              created(doc, id, name, 'lodging'),
              id,
              {
                startsAt: setDay(undefined, zone, from) ?? undefined,
                timezone: zone,
                durationMinutes: nights * 24 * 60,
              },
              STORY_AUTHOR,
            ),
          );
        }}
        onMoveEvent={(eventId, day, minutes) => {
          const zone = slots.find((slot) => slot.day === day)?.zone ?? HOME_TIMEZONE;
          const midnight = setDay(undefined, zone, day);
          const at = midnight === null ? null : setTimeOfDay(midnight, zone, clockOf(minutes));
          if (at === null) return;

          trip.apply((doc) =>
            updateEvent(
              doc,
              eventId,
              { startsAt: at, timezone: zone, timeUndecided: false },
              STORY_AUTHOR,
            ),
          );
        }}
      />
    </Frame>
  );
}

/** The first full week in Tokyo: one zone, one rail, a normal week. */
export const InTokyo: Story = {
  name: 'A week in Tokyo',
  render: () => <Week anchor="2026-05-22" />,
};

/**
 * The week the trip crosses the Pacific. Three zones, three rails, and the
 * day of the flight staying on the clock it began on.
 */
export const CrossingZones: Story = {
  name: 'Crossing zones',
  render: () => <Week anchor="2026-05-19" />,
};

/** The week the trip works its way west along the Inland Sea. */
export const Busy: Story = {
  name: 'A day stacked with legs',
  render: () => <Week anchor="2026-05-30" />,
};

/** A viewer's copy: nothing to drag, nothing to draw. */
export const ReadOnly: Story = {
  render: () => <Week anchor="2026-05-22" readOnly />,
};

/** Short, the way it is on a laptop with the browser chrome taking its cut. */
export const Short: Story = {
  render: () => <Week anchor="2026-05-22" height={360} />,
};
