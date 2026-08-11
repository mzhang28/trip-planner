import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Creates a trip and returns an editor link for it.
 *
 * Set up through the API rather than the UI. These tests are about what
 * survives going offline, and driving the create form adds steps that can fail
 * for reasons that have nothing to do with that.
 */
async function newTrip(page: Page, name: string) {
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

async function addEvent(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'New event' }).fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
}

/** Waits for the app to say the change has reached the server. */
async function expectSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
}

async function openTrip(page: Page, tripId: string) {
  await page.goto(`/t/${tripId}`);
  await expectSaved(page);
}

test.describe('offline editing', () => {
  test('events added with no network reach someone else once it comes back', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const { tripId, token } = await newTrip(page, 'Japan, April');
    await openTrip(page, tripId);

    await page.context().setOffline(true);
    await expect(page.getByTestId('sync-status')).toHaveText("Saved on this device");

    // Two events with no network at all. Both are on screen immediately,
    // because nothing here waits on a response.
    await addEvent(page, 'Fushimi Inari at dawn');
    await addEvent(page, 'Nishiki Market lunch');

    await page.context().setOffline(false);
    await expectSaved(page);

    // A second person, who has never seen this trip.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${token}`);
    await expect(otherPage).toHaveURL(new RegExp(`/t/${tripId}`));

    await expect(otherPage.getByRole('button', { name: /Fushimi Inari at dawn/ })).toBeVisible();
    await expect(otherPage.getByRole('button', { name: /Nishiki Market lunch/ })).toBeVisible();

    await other.close();
  });

  test('two people editing the same event offline both keep their edit', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const { tripId, token } = await newTrip(page, 'Japan, April');
    await openTrip(page, tripId);

    await addEvent(page, 'Fushimi Inari');
    await expectSaved(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${token}`);
    await expect(otherPage.getByRole('button', { name: /Fushimi Inari/ })).toBeVisible();
    await expectSaved(otherPage);

    // Both go offline before touching anything.
    await page.context().setOffline(true);
    await other.setOffline(true);

    // One sets the time, the other sets the booking status.
    await page.getByRole('button', { name: /Fushimi Inari/ }).click();
    await page.getByRole('textbox', { name: /Start time/ }).fill('05:30');
    await page.getByRole('textbox', { name: /Start time/ }).blur();

    await otherPage.getByRole('button', { name: /Fushimi Inari/ }).click();
    await otherPage
      .getByRole('radiogroup', { name: 'Booking status' })
      .getByText('Booked', { exact: true })
      .click();

    await page.context().setOffline(false);
    await other.setOffline(false);

    await expectSaved(page);
    await expectSaved(otherPage);

    // Each side has to pull what the other pushed, so give both a round trip.
    for (const target of [page, otherPage]) {
      await target.reload();
      await expectSaved(target);
    }

    // Neither edit was lost: the time from one, the status from the other.
    for (const target of [page, otherPage]) {
      const row = target.getByRole('button', { name: /Fushimi Inari/ });
      await expect(row).toContainText('05:30');
      await expect(row).toContainText('Booked');
    }

    await other.close();
  });

  test('a trip survives a reload with no network', async ({ page, context }) => {
    await page.goto('/');
    const { tripId } = await newTrip(page, 'Japan, April');
    await openTrip(page, tripId);

    await addEvent(page, 'Fushimi Inari');
    await expectSaved(page);

    await context.setOffline(true);
    await page.reload();

    // Served by the service worker, and the trip read back out of IndexedDB.
    await expect(page.getByRole('button', { name: /Fushimi Inari/ })).toBeVisible();
    await expect(page.getByTestId('sync-status')).toHaveText("Saved on this device");
  });
});

test.describe('sharing', () => {
  test('a viewer can read the trip but not change it', async ({ page, browser }) => {
    await page.goto('/');
    const { tripId } = await newTrip(page, 'Japan, April');
    await openTrip(page, tripId);
    await addEvent(page, 'Fushimi Inari');
    await expectSaved(page);

    const viewerToken = await page.evaluate(async (id) => {
      const res = await fetch(`/api/trips/${id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      });
      return ((await res.json()) as { token: string }).token;
    }, tripId);

    const other: BrowserContext = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${viewerToken}`);

    await expect(otherPage.getByRole('button', { name: /Fushimi Inari/ })).toBeVisible();
    // No way in to change anything: no add box and the row does not open.
    await expect(otherPage.getByRole('textbox', { name: 'New event' })).toHaveCount(0);
    await expect(otherPage.getByRole('button', { name: /Fushimi Inari/ })).toBeDisabled();

    await other.close();
  });

  test('a trip stays in your list after you have followed its link once', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const { token } = await newTrip(page, 'Japan, April');

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    await otherPage.goto('/');
    await expect(otherPage.getByText('No trips yet')).toBeVisible();

    await otherPage.goto(`/join/${token}`);
    await expect(otherPage.getByRole('heading', { name: 'Japan, April' })).toBeVisible();

    // Back to the list, with no link in hand this time.
    await otherPage.goto('/');
    await expect(otherPage.getByRole('link', { name: /Japan, April/ })).toBeVisible();

    await other.close();
  });
});
