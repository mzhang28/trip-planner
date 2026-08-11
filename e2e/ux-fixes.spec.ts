import { expect, test, type Page } from '@playwright/test';

async function newTrip(page: Page, name = 'Japan, April') {
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

async function reveal(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  if ((await editor.getByTestId(`add-field-${key}`).count()) === 0) {
    await editor.getByTestId('expand-palette').click();
  }
  await editor.getByTestId(`add-field-${key}`).click();
}

test.describe('putting an event on a chosen day', () => {
  test('a date can be set directly rather than defaulting to today', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Morning temple');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Morning temple').click();
    await reveal(page, 'when');

    // A real date control. Typing a time used to put it on today whatever day
    // was meant, which on a trip planner is the one thing not to guess.
    const date = page.getByTestId('event-date');
    await date.fill('2026-09-03');

    await page.locator('[data-testid="event"][aria-expanded="true"]').click();
    await page.getByTestId('go-to-date').fill('2026-09-03');

    await expect(page.getByTestId('range-label')).toContainText('3 September 2026');
    await expect(eventRow(page, 'Morning temple')).toBeVisible();
  });

  test('a day with nothing on it can still be added to', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByTestId('go-to-date').fill('2026-09-03');
    await page.getByTestId('add-on-2026-09-03').click();

    const name = page.getByTestId('event-editor').getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await name.fill('Decided later');
    await name.blur();

    await expect(eventRow(page, 'Decided later')).toBeVisible();
  });

  test('every view can be navigated the same way', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    for (const view of ['Day', 'Week', 'Month'] as const) {
      await page
        .getByRole('radiogroup', { name: 'Calendar view' })
        .getByText(view, { exact: true })
        .click();

      await expect(page.getByTestId('go-to-date')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
    }
  });

  test('a mistyped time says so instead of being ignored', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Morning temple');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Morning temple').click();
    await reveal(page, 'when');

    await page.getByTestId('event-date').fill('2026-09-03');

    const time = page.getByRole('textbox', { name: /Time \(/ });
    await time.fill('nine-ish');
    await time.blur();

    // Keeping the text and saying what is wrong is the difference between a
    // correction and a silent loss.
    await expect(page.getByText('Use a 24-hour time, like 09:00')).toBeVisible();
    await expect(time).toHaveValue('nine-ish');
  });
});

test.describe('what a viewer can do', () => {
  async function shareAsViewer(page: Page, tripId: string) {
    return page.evaluate(async (id) => {
      const res = await fetch(`/api/trips/${id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      });
      return ((await res.json()) as { token: string }).token;
    }, tripId);
  }

  test('a viewer can read an event, including what the card does not show', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const tripId = await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Ryokan').click();
    await reveal(page, 'confirmation');
    await page.getByRole('textbox', { name: 'Confirmation code' }).fill('7K2QLM');
    await page.getByRole('textbox', { name: 'Confirmation code' }).blur();
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

    const token = await shareAsViewer(page, tripId);

    const other = await browser.newContext();
    const viewer = await other.newPage();
    await viewer.goto(`/join/${token}`);
    await expect(viewer.getByTestId('event').filter({ hasText: 'Ryokan' })).toBeVisible();

    // The card used to be the only route to the content, and it was disabled.
    await viewer.getByTestId('event').filter({ hasText: 'Ryokan' }).click();
    await expect(viewer.getByTestId('event-details')).toBeVisible();
    await expect(viewer.getByTestId('event-details')).toContainText('7K2QLM');

    // Read-only hides the controls, not the content.
    await expect(viewer.getByTestId('event-editor')).toHaveCount(0);

    await other.close();
  });

  test('a viewer reaching the fields screen is not offered write controls', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const tripId = await newTrip(page);
    const token = await shareAsViewer(page, tripId);

    const other = await browser.newContext();
    const viewer = await other.newPage();
    await viewer.goto(`/join/${token}`);
    await viewer.goto(`/t/${tripId}/fields`);

    // Never offered, not offered and withdrawn: the controls stay hidden until
    // the role is known rather than until it is known to be viewer.
    await expect(viewer.getByRole('button', { name: 'Add field' })).toHaveCount(0);
    await expect(viewer.getByText(/Only someone who can edit/)).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Add field' })).toHaveCount(0);

    await other.close();
  });
});
