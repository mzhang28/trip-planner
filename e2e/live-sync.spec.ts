import { expect, test, type Page } from '@playwright/test';
import { addNewEvent, editEvent } from './helpers';

/**
 * Creates a trip and returns an editor link for it.
 *
 * Set up through the API rather than the UI. These tests are about what one
 * person sees when another person types, and driving the create form adds
 * steps that can fail for reasons that have nothing to do with that.
 */
async function newTrip(page: Page, name: string) {
  /*
   * Wait for the app before calling the API from inside it. The server mints a
   * person for any request that arrives without a session, so firing one before
   * the app has settled its identity creates a second person and the trip ends
   * up owned by whichever of them won the cookie.
   */
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const trip = await page.evaluate(async (tripName) => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tripName, homeTimezone: 'Asia/Tokyo' }),
    });
    return (await res.json()) as { id: string };
  }, name);

  const share = await page.evaluate(async (tripId) => {
    const res = await fetch(`/api/trips/${tripId}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    return (await res.json()) as { token: string };
  }, trip.id);

  return { tripId: trip.id, token: share.token };
}

function eventRow(page: Page, name: string) {
  return page.getByTestId('event').filter({ hasText: name });
}

async function expectSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
}

/**
 * Two people with the same trip open, and nobody reloading anything.
 *
 * Every assertion here is about a page that made no request of its own. The
 * second person's browser is told about the change over the connection it is
 * already holding, which is the difference these tests exist to hold on to.
 */
test.describe('two people with the trip open', () => {
  test('an event one person adds appears for the other', async ({ page, browser }) => {
    await page.goto('/');
    const { tripId, token } = await newTrip(page, 'Japan, April');

    await page.goto(`/t/${tripId}`);
    await expectSaved(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${token}`);
    await expect(otherPage).toHaveURL(new RegExp(`/t/${tripId}`));
    await expectSaved(otherPage);

    await addNewEvent(page, 'Fushimi Inari at dawn');

    // No reload, no navigation, no click: the row arrives on its own.
    await expect(eventRow(otherPage, 'Fushimi Inari at dawn')).toBeVisible({ timeout: 15_000 });

    await other.close();
  });

  test('a change to an event reaches the other person without a reload', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const { tripId, token } = await newTrip(page, 'Japan, April');

    await page.goto(`/t/${tripId}`);
    await expectSaved(page);
    await addNewEvent(page, 'Nishiki Market');

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${token}`);
    await expect(eventRow(otherPage, 'Nishiki Market')).toBeVisible({ timeout: 15_000 });

    // The first person gives the event a city while the second is looking at it.
    await editEvent(page, 'Nishiki Market');
    const editor = page.getByTestId('event-editor');
    if ((await editor.getByTestId('field-city').count()) === 0) {
      if ((await editor.getByTestId('add-field-city').count()) === 0) {
        await editor.getByTestId('expand-palette').click();
      }
      await editor.getByTestId('add-field-city').click();
    }
    await editor.getByRole('textbox', { name: 'City' }).fill('Kyoto');
    await editor.getByRole('textbox', { name: 'City' }).blur();
    await page.getByTestId('close-editor').click();

    await expect(eventRow(otherPage, 'Nishiki Market')).toContainText('Kyoto', {
      timeout: 15_000,
    });

    await other.close();
  });

  test('both people typing at once keeps both events', async ({ page, browser }) => {
    await page.goto('/');
    const { tripId, token } = await newTrip(page, 'Japan, April');

    await page.goto(`/t/${tripId}`);
    await expectSaved(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${token}`);
    await expect(otherPage).toHaveURL(new RegExp(`/t/${tripId}`));
    await expectSaved(otherPage);

    await Promise.all([
      addNewEvent(page, 'Fushimi Inari at dawn'),
      addNewEvent(otherPage, 'Nishiki Market lunch'),
    ]);

    // Neither edit displaced the other, on either screen.
    for (const screen of [page, otherPage]) {
      await expect(eventRow(screen, 'Fushimi Inari at dawn')).toBeVisible({ timeout: 15_000 });
      await expect(eventRow(screen, 'Nishiki Market lunch')).toBeVisible({ timeout: 15_000 });
    }

    await other.close();
  });
});
