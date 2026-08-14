import { expect, test, type Page } from '@playwright/test';
import { addNewEvent } from './helpers';

/*
 * The hours the week timetable shows out of the box. A column covers exactly
 * this range, so a time in a column is a fraction of its height.
 */
const WEEK_START_HOUR = 9;
const WEEK_HOURS = 24 - WEEK_START_HOUR;

async function newTrip(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const trip = await page.evaluate(async (tripName) => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tripName, homeTimezone: 'Asia/Tokyo' }),
    });
    return (await res.json()) as { id: string };
  }, name);

  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  return trip.id;
}

function eventRow(page: Page, name: string) {
  return page.getByTestId('event').filter({ hasText: name });
}

/** Adds an event and fills in the city and time that put it on a calendar. */
/** A fixed Wednesday, so a test never depends on which day it is run. */
const ON = '2026-08-12';

async function addEvent(page: Page, name: string, city: string, time: string, day = ON) {
  await addNewEvent(page, name);
  await expect(eventRow(page, name)).toBeVisible();

  await eventRow(page, name).click();

  // Scoped to the open editor. Two open at once would make every field query
  // ambiguous, and the assertion says which happened rather than leaving a
  // strict-mode error to be read backwards.
  const editor = page.getByTestId('event-editor');
  await expect(editor).toHaveCount(1);

  await revealField(page, 'city');
  await revealField(page, 'when');

  await editor.getByRole('textbox', { name: 'City' }).fill(city);

  // A date first, then a time. The time field is disabled until there is a day
  // for it to be a time on.
  await editor.getByTestId('event-date').fill(day);

  /*
   * Re-acquired, because setting the date moves the card into another day's
   * section and React replaces the node. Holding the old handle would fill a
   * box that is no longer on the page.
   */
  const afterDate = page.getByTestId('event-editor');
  await expect(afterDate.getByTestId('event-date')).toHaveValue(day);
  await expect(afterDate.getByRole('textbox', { name: 'Time' })).toBeEnabled();
  await afterDate.getByRole('textbox', { name: 'Time' }).fill(time);
  await afterDate.getByRole('textbox', { name: 'Time' }).blur();

  // Both halves of the instant, checked where they were typed. A day that did
  // not take leaves the event on today, and every later assertion then fails
  // somewhere else with nothing pointing back here.
  await expect(afterDate.getByTestId('event-date')).toHaveValue(day);
  await expect(eventRow(page, name)).toContainText(time);

  // Close whichever card is open. The event has moved to another day by now,
  // so it is not necessarily the one that was clicked to open it.
  await page.getByTestId('close-editor').click();
  await expect(page.getByTestId('event-editor')).toHaveCount(0);
}


/**
 * Reveals a field before filling it.
 *
 * The editor shows what an event has and offers the rest as chips, so a field
 * that has never been filled in is behind its chip -- which is the behaviour
 * being relied on here, not worked around.
 */
async function revealField(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  const chip = editor.getByTestId(`add-field-${key}`);
  const more = editor.getByTestId('expand-palette');

  // Waited for rather than counted: the palette renders a tick after the card
  // opens, and counting an element that is not there yet reads as absent.
  await expect(chip.or(more).first()).toBeVisible();

  if ((await chip.count()) === 0) await more.click();
  await chip.click();
}

async function switchTo(page: Page, view: 'Day' | 'Week' | 'Month') {
  await page
    .getByRole('radiogroup', { name: 'Calendar view' })
    .getByText(view, { exact: true })
    .click();
}

async function setTripDates(page: Page, start: string, end: string) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('trip-start-date').fill(start);
  await page.getByTestId('trip-end-date').fill(end);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  await page.getByRole('link', { name: 'Itinerary', exact: true }).click();
}

test.describe('week and month views', () => {
  test(
    'a week shows its days, and events land on the right one',
    { tag: '@responsive' },
    async ({ page }) => {
      await page.goto('/');
      await newTrip(page, 'Japan, April');

      await addEvent(page, 'Fushimi Inari', 'Kyoto', '05:30');
      await addEvent(page, 'Nishiki Market', 'Kyoto', '12:00');

      await page.getByTestId('go-to-date').fill(ON);
      await switchTo(page, 'Week');

      // Both events are on the same day, so one column holds them both.
      const week = page.getByTestId('week-event');
      const earlyEvent = week.filter({ hasText: 'Fushimi Inari' });
      await expect(earlyEvent).toBeVisible();
      await expect(week.filter({ hasText: 'Nishiki Market' })).toBeVisible();

      // Earlier in the day comes first, which is what makes a column a timeline.
      // Fushimi is at 05:30, before the hours the week shows by default: it is
      // pinned to the top of the column rather than dropped from it.
      await expect(week.first()).toContainText('Fushimi Inari');

      // The pinned event is only as tall as the minimum card. Its compact form
      // keeps the name inside the visible bounds instead of spending both rows
      // on a time and clipping the identifying text below the card.
      const cardBox = await earlyEvent.boundingBox();
      const nameBox = await earlyEvent.getByTestId('week-event-name').boundingBox();
      if (!cardBox || !nameBox) throw new Error('no compact week event bounds');
      expect(nameBox.y).toBeGreaterThanOrEqual(cardBox.y);
      expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
      await expect(earlyEvent.locator('.week-event-time')).toBeHidden();
    },
  );

  test('the city band names where you are, spanning the days you are there', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Month');

    /*
     * Named once per week row it runs into, not once per day.
     *
     * A band that continues onto the next row needs its name again, or the
     * second row is an unlabelled stripe. But repeating it in all 28 cells
     * would be the grid of dots this view exists to avoid, so the count has to
     * stay at or below the four rows this view has.
     */
    const labels = page.getByText('Kyoto', { exact: true });
    const count = await labels.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(4);
  });

  test(
    'the month-ish view is four rows, fits its space, and splits cities by time',
    { tag: '@responsive' },
    async ({ page }) => {
      await page.goto('/');
      await newTrip(page, 'Pacific crossing');
      await setTripDates(page, '2026-08-10', '2026-08-16');
      await addEvent(page, 'Morning in SF', 'San Francisco', '00:00');
      await addEvent(page, 'Arrive Tokyo', 'Tokyo', '15:00');

      await switchTo(page, 'Month');

      const grid = page.getByTestId('month-grid');
      await expect(grid.locator('[data-testid^="day-"]')).toHaveCount(28);
      await expect(page.getByTestId('day-2026-08-13')).toBeVisible();

      const cell = page.getByTestId(`day-${ON}`);
      const sf = cell.locator('[data-testid="city-time-band"][data-city="San Francisco"]');
      const tokyo = cell.locator('[data-testid="city-time-band"][data-city="Tokyo"]');
      await expect(sf).toHaveAttribute('data-from-minute', '0');
      await expect(sf).toHaveAttribute('data-to-minute', '900');
      await expect(tokyo).toHaveAttribute('data-from-minute', '900');
      await expect(tokyo).toHaveAttribute('data-to-minute', '1440');

      // The final known city carries through the trip's inclusive end date,
      // but not into the extra calendar cells after the trip.
      await expect(
        page
          .getByTestId('day-2026-08-16')
          .locator('[data-testid="city-time-band"][data-city="Tokyo"]'),
      ).toHaveCount(1);
      await expect(
        page.getByTestId('day-2026-08-17').locator('[data-testid="city-time-band"]'),
      ).toHaveCount(0);

      const [cellBox, sfBox, tokyoBox] = await Promise.all([
        cell.boundingBox(),
        sf.boundingBox(),
        tokyo.boundingBox(),
      ]);
      if (!cellBox || !sfBox || !tokyoBox) throw new Error('no month city-band bounds');
      expect(sfBox.height / cellBox.height).toBeCloseTo(15 / 24, 1);
      expect(tokyoBox.height / cellBox.height).toBeCloseTo(9 / 24, 1);

      const mainFits = await page.locator('main').evaluate(
        (element) => element.scrollHeight <= element.clientHeight,
      );
      expect(mainFits).toBe(true);
    },
  );

  test('a month names what is on each day and opens the day when clicked', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');
    await addEvent(page, 'Nishiki Market', 'Kyoto', '12:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Month');
    // Names, not a count: every day of a month said "2 things" and read alike.
    const cell = page.getByTestId('day-2026-08-12');
    await expect(cell).toContainText('Fushimi Inari');
    await expect(cell).toContainText('Nishiki Market');

    await cell.getByText('Fushimi Inari').click();

    // Clicking an event drops back into the day view with that event open.
    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
    await expect(page.getByTestId('event-editor')).toBeVisible();
  });

  test('events opened from month and week are scrolled into editing view', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 600 });
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    for (let index = 0; index < 6; index += 1) {
      await addEvent(
        page,
        `Earlier plan ${index + 1}`,
        'Kyoto',
        `${String(9 + index).padStart(2, '0')}:00`,
        '2026-08-10',
      );
    }
    await addEvent(page, 'Tokyo dinner', 'Tokyo', '18:00');

    async function expectOpenedAndScrolled() {
      const list = page.getByTestId('day-list-scroll');
      const editor = page.getByTestId('event-editor');
      await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
      await expect(editor).toBeVisible();
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

      const [listBox, editorBox] = await Promise.all([list.boundingBox(), editor.boundingBox()]);
      if (!listBox || !editorBox) throw new Error('no focused event bounds');
      expect(editorBox.y).toBeGreaterThanOrEqual(listBox.y);
      expect(editorBox.y).toBeLessThan(listBox.y + listBox.height);
    }

    await switchTo(page, 'Month');
    await page.getByTestId('month-event').filter({ hasText: 'Tokyo dinner' }).click();
    await expectOpenedAndScrolled();

    await switchTo(page, 'Week');
    await page.getByTestId('week-event').filter({ hasText: 'Tokyo dinner' }).click();
    await expectOpenedAndScrolled();
  });

  test(
    'moving between weeks changes what is shown, and the date field goes back',
    { tag: '@responsive' },
    async ({ page }) => {
      await page.goto('/');
      await newTrip(page, 'Japan, April');
      await setTripDates(page, '2026-08-05', '2026-08-25');
      await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

      await page.getByTestId('go-to-date').fill(ON);
      await switchTo(page, 'Week');

      const event = page.getByTestId('week-event').filter({ hasText: 'Fushimi Inari' });
      await expect(event).toBeInViewport();

      // Every date exists once, bounded by the trip rather than regenerated as
      // the scrollbar moves.
      const renderedDays = page.locator('[data-week-day]');
      await expect(renderedDays).toHaveCount(21);
      await expect(page.locator('[data-week-day="2026-08-05"]')).toHaveCount(1);
      await expect(page.locator('[data-week-day="2026-08-25"]')).toHaveCount(1);
      await expect(page.locator('[data-week-day="2026-08-04"]')).toHaveCount(0);
      await expect(page.locator('[data-week-day="2026-08-26"]')).toHaveCount(0);

      await page.getByRole('button', { name: 'Later' }).click();
      await expect(event).not.toBeInViewport();

      await page.getByTestId('go-to-date').fill(ON);
      await expect(event).toBeInViewport();

      const scroller = page.getByTestId('week-horizontal-scroll');
      expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      await scroller.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
      await expect(page.locator('[data-week-day="2026-08-25"]')).toBeInViewport();
      const rightEdge = await scroller.evaluate((element) => element.scrollLeft);
      await page.waitForTimeout(250);
      expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(rightEdge);
      await scroller.evaluate((element) => element.scrollTo({ left: 0 }));
      await expect(page.locator('[data-week-day="2026-08-05"]')).toBeInViewport();
    },
  );

  test('the hours stay beside the days they belong to', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-08-05', '2026-08-25');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Week');

    const scroller = page.getByTestId('week-horizontal-scroll');
    const rails = page.locator('[data-week-run] > div:first-child');

    /*
     * A sticky box is measured against the nearest ancestor that scrolls. The
     * hours had a scroller of their own for the vertical, so every rail was
     * pinned to a box that never moved sideways and the numbers scrolled off
     * with the days. Nothing about that was visible to a test that only asked
     * whether the rail existed.
     */
    const edges = async () => {
      const box = await scroller.boundingBox();
      const positions = await rails.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().left),
      );
      return positions.map((left) => Math.round(left - box!.x));
    };

    const before = await edges();
    expect(before.length).toBeGreaterThan(0);
    expect(Math.min(...before)).toBeLessThan(2);

    await scroller.evaluate((node) => node.scrollTo({ left: 400 }));
    await expect(async () => {
      expect(await scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(200);
    }).toPass();

    // Held where they were rather than dragged along by the scroll.
    expect(Math.min(...(await edges()))).toBeLessThan(2);
  });

  test('picking an event in the week opens it in the day view', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Week');
    await page.getByTestId('week-event').filter({ hasText: 'Fushimi Inari' }).click();

    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
  });

  test('a day heading opens the week focused on that day', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId(`day-heading-${ON}`).click();

    await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
    await expect(page.getByTestId('go-to-date')).toHaveValue(ON);
    await expect(page.getByTestId('week-event').filter({ hasText: 'Fushimi Inari' })).toBeVisible();
  });
});

test.describe('flights and the map', () => {
  test('a flight shows both airports in their own local times', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await addNewEvent(page, 'Flight to Osaka');
    await eventRow(page, 'Flight to Osaka').click();

    const editor = page.getByTestId('event-editor');
    await page.getByTestId('event-kind-button').click();
    await page
      .getByRole('dialog', { name: 'Event kind' })
      .getByRole('button', { name: 'Transit' })
      .click();
    // A flight is a transit journey whose method is flight, and only that method
    // opens the richer per-airport editor.
    await editor.getByTestId('transit-method').getByText('Flight', { exact: true }).click();
    await expect(
      eventRow(page, 'Flight to Osaka').getByRole('img', { name: 'Flight' }),
    ).toBeVisible();

    // The route card is the only editor for the flight's schedule and places.
    await expect(editor.getByTestId('event-date')).toHaveCount(0);
    await expect(editor.getByRole('combobox', { name: 'Place' })).toHaveCount(0);

    await editor.getByRole('textbox', { name: 'Airline' }).fill('ANA');
    await editor.getByRole('textbox', { name: 'Flight number' }).fill('nh017');

    // Each end names itself, so neither the test nor a screen reader has to
    // work out which of two fields called "Airport" is which.
    await editor.getByRole('combobox', { name: 'Leaving from' }).fill('nrt');
    await expect(
      editor.getByRole('button', { name: 'Departure time zone: Asia/Tokyo' }),
    ).toBeVisible();
    await expect(editor.getByRole('textbox', { name: 'Departure city' })).toHaveValue('Tokyo');

    // The zone rests inside the time control as a short name. Its popover can
    // still find the full IANA zone from a familiar abbreviation.
    await editor.getByRole('button', { name: 'Departure time zone: Asia/Tokyo' }).click();
    await page.getByRole('searchbox', { name: 'Search departure time zone' }).fill('JST');
    await expect(page.getByRole('option', { name: /Asia\/Tokyo/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // The date first: a time on its own used to put the flight on today,
    // whatever day the ticket says.
    await editor.getByTestId('departs-date').fill(ON);
    await editor.getByRole('textbox', { name: /Departs/ }).fill('17:05');
    await editor.getByRole('textbox', { name: /Departs/ }).blur();

    await editor.getByRole('combobox', { name: 'Arriving at' }).fill('lhr');
    await expect(
      editor.getByRole('button', { name: 'Arrival time zone: Europe/London' }),
    ).toBeVisible();
    await expect(editor.getByRole('textbox', { name: 'Arrival city' })).toHaveValue('London');
    await editor.getByRole('textbox', { name: /Arrives/ }).fill('21:30');
    await editor.getByRole('textbox', { name: /Arrives/ }).blur();

    const summary = page.getByTestId('flight-summary');
    await expect(summary).toContainText('NRT');
    await expect(summary).toContainText('17:05');
    await expect(summary).toContainText('LHR');
    await expect(summary).toContainText('21:30');

    // Codes are upper-cased on the way in, so what was typed lower-case reads
    // the way it does on a boarding pass.
    await expect(summary).not.toContainText('nrt');

    // Tokyo is eight hours ahead of London, so the clocks go back.
    await expect(summary).toContainText(/clocks back 8h/);
  });

  test('transit endpoints determine the cities before departure and after arrival', async ({
    page,
  }) => {
    await page.goto('/');
    await newTrip(page, 'Kansai by train');
    await setTripDates(page, '2026-08-10', '2026-08-16');

    await addNewEvent(page, 'Kyoto to Osaka');
    await eventRow(page, 'Kyoto to Osaka').click();
    await page.getByTestId('event-kind-button').click();
    await page
      .getByRole('dialog', { name: 'Event kind' })
      .getByRole('button', { name: 'Transit' })
      .click();

    let editor = page.getByTestId('event-editor');
    await expect(eventRow(page, 'Kyoto to Osaka').getByRole('img', { name: 'Transit' })).toBeVisible();
    await expect(editor.getByTestId('field-route')).toBeVisible();
    await editor.getByRole('textbox', { name: 'Starting city' }).fill('Kyoto');
    await editor.getByRole('textbox', { name: 'Starting city' }).blur();
    await editor.getByRole('textbox', { name: 'Ending city' }).fill('Osaka');
    await editor.getByRole('textbox', { name: 'Ending city' }).blur();

    await revealField(page, 'when');
    await editor.getByTestId('event-date').fill(ON);
    editor = page.getByTestId('event-editor');
    await editor.getByRole('textbox', { name: 'Time' }).fill('09:00');
    await editor.getByRole('textbox', { name: 'Time' }).blur();
    await revealField(page, 'duration');
    await editor.getByRole('textbox', { name: 'Ends' }).fill('12:00');
    await editor.getByRole('textbox', { name: 'Ends' }).blur();
    await page.getByTestId('close-editor').click();

    await switchTo(page, 'Week');
    const weekTravelDay = page.locator('[data-week-city-day="2026-08-12"]');
    await expect(
      weekTravelDay.locator('[data-testid="week-city-band"][data-city="Kyoto"]'),
    ).toHaveAttribute('data-to-minute', '720');
    await expect(
      weekTravelDay.locator('[data-testid="week-city-band"][data-city="Osaka"]'),
    ).toHaveAttribute('data-from-minute', '720');

    await switchTo(page, 'Month');

    await expect(
      page
        .getByTestId('day-2026-08-11')
        .locator('[data-testid="city-time-band"][data-city="Kyoto"]'),
    ).toHaveCount(1);

    const travelDay = page.getByTestId(`day-${ON}`);
    await expect(
      travelDay.locator('[data-testid="city-time-band"][data-city="Kyoto"]'),
    ).toHaveAttribute('data-to-minute', '720');
    await expect(
      travelDay.locator('[data-testid="city-time-band"][data-city="Osaka"]'),
    ).toHaveAttribute('data-from-minute', '720');
    await expect(
      page
        .getByTestId('day-2026-08-13')
        .locator('[data-testid="city-time-band"][data-city="Osaka"]'),
    ).toHaveCount(1);
  });

  test('the map stays out of the way until something has a place', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    // One line rather than an empty panel taking half the width to say it.
    await expect(page.getByTestId('empty-map')).toBeVisible();
    await expect(page.getByTestId('day-map')).toHaveCount(0);
  });
});

test.describe('selecting several events', () => {
  test('ticking events offers bulk actions, and delete removes them all', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    for (const name of ['Fushimi Inari', 'Nishiki Market', 'Dotonbori']) {
      await addNewEvent(page, name);
      await expect(eventRow(page, name)).toBeVisible();
    }

    await page.getByTestId('event-select').nth(0).check();
    await page.getByTestId('event-select').nth(1).check();

    const bar = page.getByTestId('selection-bar');
    await expect(bar).toContainText('2 selected');

    await bar.getByRole('button', { name: /Delete 2/ }).click();

    await expect(page.getByTestId('event')).toHaveCount(1);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('merging folds the others into the one that gives the name', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    for (const name of ['Market, morning', 'Market, afternoon']) {
      await addNewEvent(page, name);
      await expect(eventRow(page, name)).toBeVisible();
    }

    await page.getByTestId('event-select').nth(0).check();
    await page.getByTestId('event-select').nth(1).check();
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Merge' }).click();

    // The dialog says what survives before anything is folded in.
    const dialog = page.getByTestId('merge-preview');
    await expect(dialog).toContainText('Merge 2 events');
    await dialog.getByRole('button', { name: /Merge into/ }).click();

    await expect(page.getByTestId('event')).toHaveCount(1);
  });
});

test.describe('getting between events', () => {
  test('a journey that does not fit the gap says how short it is', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    // Two events twenty minutes apart, with a forty-five minute journey between.
    await addEvent(page, 'Nishiki Market', 'Kyoto', '12:00');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '12:20');

    await eventRow(page, 'Fushimi Inari').click();
    const editor = page.getByTestId('event-editor');
    await revealField(page, 'transit');

    await editor.getByTestId('field-transit').getByRole('textbox', { name: 'How long' }).fill('45');
    await editor.getByTestId('field-transit').getByRole('textbox', { name: 'How long' }).blur();
    await page.getByTestId('close-editor').click();

    const leg = page.getByTestId('transit-leg');
    await expect(leg).toContainText('45 min');
    await expect(leg).toContainText('25 min short of the gap');
  });
});

test.describe('filling an event in gradually', () => {
  test('the trip canvas uses the full desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    // Everything to the right of the navigation sidebar belongs to the trip.
    // A centred max-width column would leave empty gutters on a wide screen,
    // so both the toolbar and the canvas must reach the far edge.
    const sidebar = page.getByRole('complementary', { name: 'Trip navigation' });
    const sidebarBox = await sidebar.boundingBox();
    if (!sidebarBox) throw new Error('no sidebar bounds');
    const contentLeft = Math.round(sidebarBox.x + sidebarBox.width);

    for (const region of [page.locator('main'), page.getByTestId('trip-toolbar')]) {
      await expect
        .poll(async () => {
          const box = await region.boundingBox();
          return box && [Math.round(box.x), Math.round(box.x + box.width)];
        })
        .toEqual([contentLeft, 1920]);
    }
  });

  test('only the day event list scrolls', { tag: '@responsive' }, async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    for (let index = 1; index <= 18; index += 1) {
      await addNewEvent(page, `Event ${index}`);
    }

    const list = page.getByTestId('day-list-scroll');
    await expect
      .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    const navigator = page.getByTestId('go-to-date');
    const navigatorTop = (await navigator.boundingBox())!.y;
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('main').evaluate((element) => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect((await navigator.boundingBox())!.y).toBeCloseTo(navigatorTop, 0);
  });

  test('a new event shows almost nothing, and fields arrive when asked for', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await addNewEvent(page, 'Fushimi Inari');
    await eventRow(page, 'Fushimi Inari').click();

    const editor = page.getByTestId('event-editor');

    // Name and kind live in the compact header instead of being repeated as
    // full-width editor fields.
    await expect(page.getByTestId('event-name')).toHaveText('Fushimi Inari');
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
    await page.getByTestId('event-name').dblclick();
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name' }).press('Escape');
    await expect(editor.getByTestId('field-kind')).toHaveCount(0);
    await expect(page.getByTestId('event-kind-button')).toHaveAccessibleName(
      'Change kind, currently Event',
    );
    await expect(editor.getByTestId('field-booking')).toHaveCount(0);
    await expect(page.getByTestId('booking-status-button')).toHaveAccessibleName(
      'Change booking status, currently Flexible',
    );
    await expect(eventRow(page, 'Fushimi Inari').getByRole('img', { name: 'Event' })).toBeVisible();
    await expect(editor.getByTestId('field-city')).toHaveCount(0);
    await expect(editor.getByTestId('field-when')).toHaveCount(0);

    await editor.getByTestId('add-field-city').click();
    await expect(editor.getByTestId('field-city')).toBeVisible();

    // Its chip goes once it is on the event, so nothing is offered twice.
    await expect(editor.getByTestId('add-field-city')).toHaveCount(0);
  });

  test(
    'a collapsed event can change between Flexible and Confirmed',
    { tag: '@responsive' },
    async ({ page }) => {
      await page.goto('/');
      await newTrip(page, 'Japan, April');
      await addNewEvent(page, 'Fushimi Inari');

      await expect(page.getByTestId('event-editor')).toHaveCount(0);
      const picker = page.getByTestId('booking-status-button');
      await expect(picker).toHaveAccessibleName('Change booking status, currently Flexible');
      await picker.click();

      const dialog = page.getByRole('dialog', { name: 'Booking status' });
      await expect(dialog.getByRole('button')).toHaveCount(2);
      await expect(dialog.getByRole('button', { name: 'Flexible' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Confirmed' }).click();

      await expect(page.getByTestId('event-editor')).toHaveCount(0);
      await expect(page.getByTestId('booking-status-button')).toHaveAccessibleName(
        'Change booking status, currently Confirmed',
      );
    },
  );

  test('the palette folds the long tail away behind a count', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await addNewEvent(page, 'Fushimi Inari');
    await eventRow(page, 'Fushimi Inari').click();

    const editor = page.getByTestId('event-editor');
    const expand = editor.getByTestId('expand-palette');

    // Laying every field out at once is the wall this exists to avoid.
    await expect(expand).toBeVisible();
    await expect(editor.getByTestId('add-field-transit')).toHaveCount(0);

    await expand.click();
    await expect(editor.getByTestId('add-field-transit')).toBeVisible();
  });

  test('a field that has something in it is there without being asked for', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    // Reopened from scratch: the city and time show because they hold
    // something, and are not offered as chips again.
    await eventRow(page, 'Fushimi Inari').click();
    const editor = page.getByTestId('event-editor');

    await expect(editor.getByTestId('field-city')).toBeVisible();
    await expect(editor.getByTestId('field-when')).toBeVisible();
    await expect(editor.getByTestId('add-field-city')).toHaveCount(0);
  });
});

test.describe('moving an event in the week', () => {
  /**
   * Drags a card to a time on a day, by pixels worked out from the column.
   *
   * The press lands on the middle of the card and the card keeps its position
   * under the hand, so the pointer has to finish half a card below the time
   * being aimed at.
   */
  async function dragTo(page: Page, name: string, day: string, hour: number) {
    const card = page.getByTestId('week-event').filter({ hasText: name });
    const column = page.locator(`[data-week-column="${day}"]`);

    const cardBox = await card.boundingBox();
    const columnBox = await column.boundingBox();
    if (!cardBox || !columnBox) throw new Error('no week bounds to drag between');

    const perMinute = columnBox.height / (WEEK_HOURS * 60);
    const targetTop = columnBox.y + (hour - WEEK_START_HOUR) * 60 * perMinute;

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    // More than one step: a single jump can arrive before the drag has begun.
    await page.mouse.move(columnBox.x + columnBox.width / 2, targetTop + cardBox.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
  }

  test('an event can be dragged to another time and put back', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-08-10', '2026-08-16');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Week');

    const card = page.getByTestId('week-event').filter({ hasText: 'Fushimi Inari' });
    await expect(card).toContainText('09:00');

    // Dropped at half past one, which is a time somebody would say. Anything
    // between 13:15 and 13:44 lands here: the half hour is the grain.
    await dragTo(page, 'Fushimi Inari', ON, 13.5);
    await expect(card).toContainText('13:30');

    // Ctrl+Z, which is where a hand goes first after a drag that missed.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(card).toContainText('09:00');

    // And the same thing from the toolbar, for a hand that does not know that.
    await dragTo(page, 'Fushimi Inari', ON, 13.5);
    await expect(card).toContainText('13:30');
    await expect(page.getByTestId('undo-last')).toHaveAccessibleName(
      'Undo: Moved Fushimi Inari',
    );
    await page.getByTestId('undo-last').click();
    await expect(card).toContainText('09:00');
  });

  test('dragging sideways moves an event to another day', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-08-10', '2026-08-16');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Week');

    const next = '2026-08-13';
    await dragTo(page, 'Fushimi Inari', next, 11);

    // In the next day's column, at the hour it was dropped on.
    const moved = page.locator(`[data-week-column="${next}"]`).getByTestId('week-event');
    await expect(moved).toContainText('Fushimi Inari');
    await expect(moved).toContainText('11:00');

    // A click after a drag opens nothing: the release that ended the drag also
    // fires one, and the move was the whole gesture.
    await expect(page.getByTestId('event-editor')).toHaveCount(0);
  });

  test('a click on an event still opens it', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await page.getByTestId('go-to-date').fill(ON);
    await switchTo(page, 'Week');

    await page.getByTestId('week-event').filter({ hasText: 'Fushimi Inari' }).click();
    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(page.getByTestId('event-editor')).toBeVisible();
  });
});

test.describe('making an event from the calendar', () => {
  test('clicking a day in the month makes an event on that day', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await switchTo(page, 'Month');

    const today = new Date().toISOString().slice(0, 10);
    await page.getByTestId(`add-on-${today}`).click();

    // It drops into the day, with the day filled in and the name waiting.
    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(page.getByTestId('event-editor')).toBeVisible();

    const name = page.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();

    await name.fill('Decided later');
    await name.blur();
    await expect(eventRow(page, 'Decided later')).toBeVisible();
  });

  test('the date in a month cell opens the day rather than making anything', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await switchTo(page, 'Month');
    const today = new Date().toISOString().slice(0, 10);
    await page.getByRole('button', { name: `Open ${today}` }).click();

    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    // One event, not two: opening a day must not leave something behind.
    await expect(page.getByTestId('event')).toHaveCount(1);
  });

  test('dragging down a day in the week makes an event over that time', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await switchTo(page, 'Week');

    const column = page.locator('[data-testid^="day-2"]').first();
    await expect(column).toBeVisible();
    await column.scrollIntoViewIfNeeded();

    const box = await column.boundingBox();
    if (!box) throw new Error('no week column to drag on');

    /*
     * The column covers the hours the week is set to show, top to bottom, so a
     * time is a fraction of its height rather than a fixed number of pixels.
     * This drags from 10:00 to 12:00. The grid has a time axis, which is what
     * makes dragging say when as well as which day -- the whole reason to drag
     * rather than tap.
     */
    const at = (hour: number) => box.y + ((hour - WEEK_START_HOUR) / WEEK_HOURS) * box.height;

    await page.mouse.move(box.x + box.width / 2, at(10));
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, at(12), { steps: 10 });
    await page.mouse.up();

    const draft = page.getByTestId('week-event-draft');
    await expect(draft).toBeVisible();
    const name = draft.getByRole('textbox', { name: 'Event name' });
    await expect(name).toBeFocused();
    await name.fill('Nishiki Market');
    await name.press('Enter');

    // Creation stays in the week and does not open the full editor. Clicking
    // the finished event is the explicit next step that opens its details.
    await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
    await expect(page.getByTestId('event-editor')).toHaveCount(0);
    const created = page.getByTestId('week-event').filter({ hasText: 'Nishiki Market' });
    await expect(created).toBeVisible();
    await created.click();

    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    const editor = page.getByTestId('event-editor');
    await expect(editor).toBeVisible();

    await expect(editor.getByRole('textbox', { name: 'Time' })).toHaveValue('10:00');
    await expect(editor.getByTestId('field-duration')).toBeVisible();
    await expect(editor.getByRole('textbox', { name: 'Ends' })).toHaveValue('12:00');
    await expect(editor.getByText('Duration: 2 hr')).toBeVisible();
  });

  test('a column on another clock makes the event on that clock', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Pacific crossing');
    await switchTo(page, 'Week');

    /*
     * The trip is kept in Tokyo, and these days are spent in London. Set from
     * the rail rather than worked out from a flight, which is the same override
     * either way and does not make the test depend on the flight fields.
     */
    const rail = page.getByTestId('week-zone-tag').first();
    await rail.getByRole('button').click();
    await page.getByRole('searchbox', { name: /^Search zone for these days/i }).fill('London');
    await page.getByRole('option', { name: /Europe\/London/ }).first().click();
    await expect(rail).toHaveAttribute('data-zone', 'Europe/London');

    const column = page.locator('[data-testid^="day-2"]').first();
    await column.scrollIntoViewIfNeeded();

    const box = await column.boundingBox();
    if (!box) throw new Error('no week column to drag on');

    const at = (hour: number) => box.y + ((hour - WEEK_START_HOUR) / WEEK_HOURS) * box.height;

    await page.mouse.move(box.x + box.width / 2, at(10));
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, at(12), { steps: 10 });
    await page.mouse.up();

    const name = page.getByTestId('week-event-draft').getByRole('textbox', { name: 'Event name' });
    await name.fill('Borough Market');
    await name.press('Enter');

    /*
     * Ten o'clock where the day is spent. Made on the home clock instead, this
     * would be two in the morning in London -- above the hours the week draws,
     * so the event would not even be in the column it was dragged out of.
     */
    const created = page.getByTestId('week-event').filter({ hasText: 'Borough Market' });
    await expect(created).toBeVisible();
    await created.click();

    const editor = page.getByTestId('event-editor');
    await expect(editor.getByRole('textbox', { name: 'Time' })).toHaveValue('10:00');
    await expect(editor.getByRole('textbox', { name: 'Ends' })).toHaveValue('12:00');
    await expect(editor.getByRole('button', { name: 'Time zone: Europe/London' })).toBeVisible();
  });
});

test.describe('booking somewhere to sleep from the week', () => {
  /** The day after a given one, for reading a checkout off a last night. */
  function nextDay(day: string) {
    const at = Date.parse(`${day}T12:00:00Z`) + 24 * 60 * 60 * 1000;
    return new Date(at).toISOString().slice(0, 10);
  }

  function night(page: Page, day: string) {
    return page.locator(`[data-testid="week-add-lodging"][data-day="${day}"]`);
  }

  /** Presses one night and lets go on another, as a finger or a mouse would. */
  async function dragAcross(page: Page, from: string, to: string) {
    const start = await night(page, from).boundingBox();
    const end = await night(page, to).boundingBox();
    if (!start || !end) throw new Error('a night to drag between was not on screen');

    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
    await page.mouse.up();
  }

  async function nameIt(page: Page, hotel: string) {
    const name = page.getByTestId('week-event-draft').getByRole('textbox', { name: 'Hotel name' });
    await expect(name).toBeFocused();
    await name.fill(hotel);
    await name.press('Enter');
  }

  /** Reads the dates back off the stay itself, which is what was booked. */
  async function datesOf(page: Page, hotel: string) {
    await page.getByTestId('week-lodging').filter({ hasText: hotel }).click();
    const editor = page.getByTestId('event-editor');
    await expect(editor).toBeVisible();

    return {
      checkIn: await editor.getByTestId('check-in').inputValue(),
      checkOut: await editor.getByTestId('check-out').inputValue(),
    };
  }

  test('every night with no hotel is offered on its own', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-09-01', '2026-09-05');
    await switchTo(page, 'Week');

    // One per night rather than one across the week, so a single night can be
    // booked without first narrowing something wider.
    await expect(page.getByTestId('week-add-lodging')).toHaveCount(5);
    await expect(night(page, '2026-09-03')).toBeVisible();
  });

  test('pressing one night books that night alone', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-09-01', '2026-09-05');
    await switchTo(page, 'Week');

    await night(page, '2026-09-03').click();
    await nameIt(page, 'Ryokan Kyoto');

    // Booking stays in the week rather than opening the day editor.
    await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
    await expect(
      page.getByTestId('week-lodging').filter({ hasText: 'Ryokan Kyoto' }),
    ).toBeVisible();

    // The other four nights are still on offer.
    await expect(page.getByTestId('week-add-lodging')).toHaveCount(4);

    expect(await datesOf(page, 'Ryokan Kyoto')).toEqual({
      checkIn: '2026-09-03',
      checkOut: nextDay('2026-09-03'),
    });
  });

  test('dragging along the rail books every night it covers', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-09-01', '2026-09-05');
    await switchTo(page, 'Week');

    await dragAcross(page, '2026-09-02', '2026-09-04');
    await nameIt(page, 'Ryokan Kyoto');

    // Three nights in one gesture, and the two it never reached still offered.
    await expect(page.getByTestId('week-add-lodging')).toHaveCount(2);
    await expect(night(page, '2026-09-01')).toBeVisible();
    await expect(night(page, '2026-09-05')).toBeVisible();

    expect(await datesOf(page, 'Ryokan Kyoto')).toEqual({
      checkIn: '2026-09-02',
      checkOut: nextDay('2026-09-04'),
    });
  });

  test('dragging backwards works the same as dragging forwards', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-09-01', '2026-09-05');
    await switchTo(page, 'Week');

    await dragAcross(page, '2026-09-04', '2026-09-02');
    await nameIt(page, 'Ryokan Kyoto');

    expect(await datesOf(page, 'Ryokan Kyoto')).toEqual({
      checkIn: '2026-09-02',
      checkOut: nextDay('2026-09-04'),
    });
  });

  test('a drag stops at a night that already has a hotel', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await setTripDates(page, '2026-09-01', '2026-09-05');
    await switchTo(page, 'Week');

    // Take the middle night, leaving a free night either side of it.
    await night(page, '2026-09-03').click();
    await nameIt(page, 'Ryokan Kyoto');
    await switchTo(page, 'Week');

    // Now drag from the first night towards the last, straight over the hotel.
    await dragAcross(page, '2026-09-01', '2026-09-05');
    await nameIt(page, 'Guest house');

    // It stopped where the hotel starts rather than booking over it, so the
    // two nights past the hotel are still on offer.
    expect(await datesOf(page, 'Guest house')).toEqual({
      checkIn: '2026-09-01',
      checkOut: '2026-09-03',
    });

    await switchTo(page, 'Week');
    await expect(page.getByTestId('week-add-lodging')).toHaveCount(2);
    await expect(night(page, '2026-09-04')).toBeVisible();
    await expect(night(page, '2026-09-05')).toBeVisible();
  });

  test('a tap books a night where a drag would scroll the week @touch', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await switchTo(page, 'Week');

    // Whichever nights this trip works out for itself. One of them is all this
    // needs: the point here is the gesture, not the range.
    const offer = page.getByTestId('week-add-lodging').first();
    await expect(offer).toBeVisible();
    const day = await offer.getAttribute('data-day');
    if (!day) throw new Error('the offer did not say which night it covers');

    await offer.tap();
    await nameIt(page, 'Ryokan Kyoto');

    await expect(
      page.getByTestId('week-lodging').filter({ hasText: 'Ryokan Kyoto' }),
    ).toBeVisible();
    expect(await datesOf(page, 'Ryokan Kyoto')).toEqual({
      checkIn: day,
      checkOut: nextDay(day),
    });
  });

  test('a viewer is not offered nights they could not book', async ({ page, browser }) => {
    await page.goto('/');
    const tripId = await newTrip(page, 'Japan, April');

    const token = await page.evaluate(async (id) => {
      const res = await fetch(`/api/trips/${id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      });
      return ((await res.json()) as { token: string }).token;
    }, tripId);

    const other = await browser.newContext();
    const viewer = await other.newPage();
    await viewer.goto(`/join/${token}`);
    await expect(viewer).toHaveURL(new RegExp(`/t/${tripId}`));
    await switchTo(viewer, 'Week');

    await expect(viewer.getByTestId('week-add-lodging')).toHaveCount(0);
    await expect(viewer.getByText('No hotels this week')).toBeVisible();

    await other.close();
  });
});
