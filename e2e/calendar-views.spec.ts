import { expect, test, type Page } from '@playwright/test';

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
  await page.getByRole('textbox', { name: 'New event' }).fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
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
  await page.getByRole('link', { name: 'Trip settings' }).click();
  await page.getByTestId('trip-start-date').fill(start);
  await page.getByTestId('trip-end-date').fill(end);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  await page.getByRole('link', { name: 'Back to trip' }).click();
}

test.describe('week and month views', () => {
  test('a week shows its days, and events land on the right one', async ({ page }) => {
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
  });

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
     * second row is an unlabelled stripe. But repeating it in all 42 cells
     * would be the grid of dots this view exists to avoid, so the count has to
     * stay at or below the six rows a month grid can have.
     */
    const labels = page.getByText('Kyoto', { exact: true });
    const count = await labels.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(6);
  });

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

    // Clicking a day drops back into the day view, on that day.
    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
  });

  test('moving between weeks changes what is shown, and Today comes back', async ({ page }) => {
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Flight to Osaka');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Flight to Osaka').click();

    const editor = page.getByTestId('event-editor');
    await page.getByTestId('event-kind-button').click();
    await page.getByRole('dialog', { name: 'Event kind' }).getByRole('button', { name: 'Flight' }).click();
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
      await page.getByRole('textbox', { name: 'New event' }).fill(name);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
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
      await page.getByRole('textbox', { name: 'New event' }).fill(name);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
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

  test('merging is offered only once there is something to merge with', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await page.getByRole('textbox', { name: 'New event' }).fill('Only one');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('event-select').first().check();

    // Merging one thing into itself is not an operation.
    await expect(
      page.getByTestId('selection-bar').getByRole('button', { name: 'Merge' }),
    ).toBeDisabled();
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

  test('a journey that fits is stated without a warning', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await addEvent(page, 'Nishiki Market', 'Kyoto', '12:00');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '14:00');

    await eventRow(page, 'Fushimi Inari').click();
    const editor = page.getByTestId('event-editor');
    await revealField(page, 'transit');
    await editor.getByTestId('field-transit').getByRole('textbox', { name: 'How long' }).fill('20');
    await editor.getByTestId('field-transit').getByRole('textbox', { name: 'How long' }).blur();
    await page.getByTestId('close-editor').click();

    const leg = page.getByTestId('transit-leg');
    await expect(leg).toContainText('20 min');
    await expect(leg).not.toContainText('short of the gap');
  });
});

test.describe('filling an event in gradually', () => {
  test('the trip canvas uses the full desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await expect
      .poll(() => page.locator('main').evaluate((element) => element.getBoundingClientRect().width))
      .toBe(1920);
    await expect
      .poll(() =>
        page
          .getByTestId('trip-toolbar')
          .evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBe(1920);
  });

  test('only the day event list scrolls', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    for (let index = 1; index <= 18; index += 1) {
      await page.getByRole('textbox', { name: 'New event' }).fill(`Event ${index}`);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }

    const list = page.getByTestId('day-list-scroll');
    await expect
      .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    const navigator = page.getByTestId('range-label');
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
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
      'Change booking status, currently Idea',
    );
    await page.getByTestId('booking-status-button').click();
    await page
      .getByRole('dialog', { name: 'Booking status' })
      .getByRole('button', { name: 'In progress' })
      .click();
    await expect(page.getByTestId('booking-status-button')).toHaveAccessibleName(
      'Change booking status, currently In progress',
    );
    await expect(eventRow(page, 'Fushimi Inari').getByRole('img', { name: 'Event' })).toBeVisible();
    await expect(editor.getByTestId('field-city')).toHaveCount(0);
    await expect(editor.getByTestId('field-when')).toHaveCount(0);

    await editor.getByTestId('add-field-city').click();
    await expect(editor.getByTestId('field-city')).toBeVisible();

    // Its chip goes once it is on the event, so nothing is offered twice.
    await expect(editor.getByTestId('add-field-city')).toHaveCount(0);
  });

  test('the palette folds the long tail away behind a count', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
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
    await expect(editor.getByRole('textbox', { name: 'How long' }).first()).toHaveValue('120');
  });
});
