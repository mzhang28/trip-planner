import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { addNewEvent } from './helpers';

/**
 * Creates a trip and returns an editor link for it.
 *
 * Set up through the API rather than the UI. These tests are about what
 * survives going offline, and driving the create form adds steps that can fail
 * for reasons that have nothing to do with that.
 */
async function newTrip(page: Page, name: string) {
  /*
   * Wait for the app before calling the API from inside it.
   *
   * The server mints a person for any request that arrives without a session,
   * and the app settles its identity on load. Firing a request before that has
   * finished creates a second person, and the trip ends up owned by whichever
   * of them lost the race for the cookie -- so the browser is refused on a trip
   * it just made.
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

async function addEvent(page: Page, name: string) {
  await addNewEvent(page, name);
  await expect(eventRow(page, name)).toBeVisible();
}

/**
 * The card for one event.
 *
 * By test id rather than by role and name: the drag handle beside the card
 * names the event too, so a name-based query matches both.
 */
function eventRow(page: Page, name: string) {
  return page.getByTestId('event').filter({ hasText: name });
}

/**
 * Reveals a field before filling it.
 *
 * The editor shows what an event has and offers the rest as chips, so a field
 * never filled in is behind its chip. That is the behaviour being relied on
 * here, not worked around.
 */
async function revealField(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  if ((await editor.getByTestId(`add-field-${key}`).count()) === 0) {
    await editor.getByTestId('expand-palette').click();
  }
  await editor.getByTestId(`add-field-${key}`).click();
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

    await expect(eventRow(otherPage, 'Fushimi Inari at dawn')).toBeVisible();
    await expect(eventRow(otherPage, 'Nishiki Market lunch')).toBeVisible();

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
    await expect(eventRow(otherPage, 'Fushimi Inari')).toBeVisible();
    await expectSaved(otherPage);

    // Both go offline before touching anything.
    await page.context().setOffline(true);
    await other.setOffline(true);

    // One sets the time, the other sets the booking status.
    await eventRow(page, 'Fushimi Inari').click();
    await revealField(page, 'when');
    await page.getByTestId('event-date').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('textbox', { name: 'Time' }).fill('05:30');
    await page.getByRole('textbox', { name: 'Time' }).blur();

    await otherPage.getByTestId('booking-status-button').click();
    await otherPage
      .getByRole('dialog', { name: 'Booking status' })
      .getByRole('button', { name: 'Confirmed' })
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
      await expect(eventRow(target, 'Fushimi Inari')).toContainText('05:30');
      await expect(target.getByTestId('booking-status-button')).toHaveAccessibleName(
        'Change booking status, currently Confirmed',
      );
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
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
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

    await expect(eventRow(otherPage, 'Fushimi Inari')).toBeVisible();
    // No way in to change anything: no add box and the row does not open.
    await expect(otherPage.getByRole('button', { name: 'Add event' })).toHaveCount(0);

    // The card opens, into details rather than the editor. Read-only hides the
    // controls, not the content.
    await eventRow(otherPage, 'Fushimi Inari').click();
    await expect(otherPage.getByTestId('event-details')).toBeVisible();
    await expect(otherPage.getByTestId('event-editor')).toHaveCount(0);

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

test.describe('finding things', () => {
  test('search finds an event and jumps to a day', async ({ page }) => {
    await page.goto('/');
    const { tripId } = await newTrip(page, 'Japan, April');
    await openTrip(page, tripId);

    await addEvent(page, 'Fushimi Inari at dawn');
    await addEvent(page, 'Nishiki Market lunch');
    await expectSaved(page);

    const box = page.getByRole('combobox', { name: 'Search this trip' }).first();

    // An entity match takes you to the event.
    await box.fill('nishiki');
    await expect(page.getByRole('option', { name: /Nishiki Market lunch/ })).toBeVisible();
    await box.press('Enter');
    await expect(box).toHaveValue('');

    // A date reads as a day rather than as a name.
    await box.fill('aug 20');
    await expect(page.getByRole('option', { name: /Jump to this day/ })).toBeVisible();

    // And an action is offered by what it does.
    await box.fill('invite');
    await expect(page.getByRole('option', { name: /Share this trip/ })).toBeVisible();
  });
});

test.describe('moving events', () => {
  test('an event can be moved to another day from the keyboard', async ({ page }) => {
    await page.goto('/');
    const { tripId } = await newTrip(page, 'Japan, April');
    await openTrip(page, tripId);

    await addEvent(page, 'Fushimi Inari');
    await eventRow(page, 'Fushimi Inari').click();
    await revealField(page, 'when');
    await page.getByTestId('event-date').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('textbox', { name: 'Time' }).fill('09:00');
    await page.getByRole('textbox', { name: 'Time' }).blur();
    await page.getByTestId('close-editor').click();
    await expectSaved(page);

    const before = await page.locator('main section h2').first().textContent();

    /*
     * Driven by keyboard rather than by a synthesised mouse drag. Moving an
     * event between days is the only way to reschedule it, so it has to work
     * without a pointer -- and asserting that here covers the pointer path too,
     * since both end in the same drop handler.
     */
    const grip = page.getByRole('button', { name: /Move Fushimi Inari to another day/ });
    await grip.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');

    // The time of day survives the move, whichever day it landed on.
    await expect(eventRow(page, 'Fushimi Inari')).toContainText('09:00');
    await expect(page.locator('main section h2').first()).toHaveText(String(before));
  });

  test('a viewer gets no grip, because there is nothing they may move', async ({
    page,
    browser,
  }) => {
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

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`/join/${viewerToken}`);

    await expect(eventRow(otherPage, 'Fushimi Inari')).toBeVisible();
    await expect(otherPage.getByRole('button', { name: /Move .* to another day/ })).toHaveCount(0);

    await other.close();
  });
});
