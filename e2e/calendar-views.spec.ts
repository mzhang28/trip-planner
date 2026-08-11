import { expect, test, type Page } from '@playwright/test';

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
async function addEvent(page: Page, name: string, city: string, time: string) {
  await page.getByRole('textbox', { name: 'New event' }).fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(eventRow(page, name)).toBeVisible();

  await eventRow(page, name).click();

  // Scoped to the open editor. Two open at once would make every field query
  // ambiguous, and the assertion says which happened rather than leaving a
  // strict-mode error to be read backwards.
  const editor = page.getByTestId('event-editor');
  await expect(editor).toHaveCount(1);

  await editor.getByRole('textbox', { name: 'City' }).fill(city);
  await editor.getByRole('textbox', { name: /Start time/ }).fill(time);
  await editor.getByRole('textbox', { name: /Start time/ }).blur();

  // Close whichever card is open. The event has moved to another day by now,
  // so it is not necessarily the one that was clicked to open it.
  await page.locator('[data-testid="event"][aria-expanded="true"]').click();
  await expect(page.getByTestId('event-editor')).toHaveCount(0);
}

async function switchTo(page: Page, view: 'Day' | 'Week' | 'Month') {
  await page
    .getByRole('radiogroup', { name: 'Calendar view' })
    .getByText(view, { exact: true })
    .click();
}

test.describe('week and month views', () => {
  test('a week shows its days, and events land on the right one', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');

    await addEvent(page, 'Fushimi Inari', 'Kyoto', '05:30');
    await addEvent(page, 'Nishiki Market', 'Kyoto', '12:00');

    await switchTo(page, 'Week');

    // Both events fall on today, so today's column holds them both.
    const week = page.getByTestId('week-event');
    await expect(week.filter({ hasText: 'Fushimi Inari' })).toBeVisible();
    await expect(week.filter({ hasText: 'Nishiki Market' })).toBeVisible();

    // Earlier in the day comes first, which is what makes a column a timeline.
    await expect(week.first()).toContainText('Fushimi Inari');
  });

  test('the city band names where you are, spanning the days you are there', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

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

  test('a month counts what is on each day and opens the day when clicked', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');
    await addEvent(page, 'Nishiki Market', 'Kyoto', '12:00');

    await switchTo(page, 'Month');
    await expect(page.getByText('2 things')).toBeVisible();

    await page.getByText('2 things').click();

    // Clicking a day drops back into the day view, on that day.
    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
  });

  test('moving between weeks changes what is shown, and Today comes back', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await switchTo(page, 'Week');
    await expect(page.getByTestId('week-event')).toHaveCount(1);

    await page.getByRole('button', { name: 'Later' }).click();
    await expect(page.getByTestId('week-event')).toHaveCount(0);

    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByTestId('week-event')).toHaveCount(1);
  });

  test('picking an event in the week opens it in the day view', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Japan, April');
    await addEvent(page, 'Fushimi Inari', 'Kyoto', '09:00');

    await switchTo(page, 'Week');
    await page.getByTestId('week-event').filter({ hasText: 'Fushimi Inari' }).click();

    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
  });
});
