import { expect, test, type Page } from '@playwright/test';
import { addNewEvent, closeEvent, editEvent, goToScreen } from './helpers';

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

/**
 * Reveals a field before filling it.
 *
 * The editor shows what an event has and offers the rest as chips, so a field
 * nobody has filled in yet is behind its chip.
 */
async function revealField(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  const chip = editor.getByTestId(`add-field-${key}`);
  const more = editor.getByTestId('expand-palette');

  await expect(chip.or(more).first()).toBeVisible();
  if ((await chip.count()) === 0) await more.click();
  await chip.click();
}

/** Adds an event and puts it on a day at a time, which is what a feed carries. */
async function schedule(page: Page, name: string, day: string, time: string) {
  await addNewEvent(page, name);
  await editEvent(page, name);
  await revealField(page, 'when');

  await page.getByTestId('event-editor').getByTestId('event-date').fill(day);

  /*
   * Re-acquired, because setting the date moves the card into another day's
   * section and React replaces the node. Holding the old handle would fill a
   * box that is no longer on the page.
   */
  const editor = page.getByTestId('event-editor');
  await expect(editor.getByTestId('event-date')).toHaveValue(day);
  await expect(editor.getByRole('textbox', { name: 'Time' })).toBeEnabled();
  await editor.getByRole('textbox', { name: 'Time' }).fill(time);
  await editor.getByRole('textbox', { name: 'Time' }).blur();

  await expect(page.getByTestId('event').filter({ hasText: name })).toContainText(time);
  await closeEvent(page, name);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
}

/**
 * Fetches the feed the way a calendar client would: from nothing but the URL.
 *
 * A fresh context, so none of this browser's cookies come with it. That is the
 * claim worth testing — a subscription has to work for something that has never
 * signed in and has no way to.
 *
 * Asked for by path against the app's own origin. The address the panel shows
 * is absolute and built from PUBLIC_URL, which in this run names a port nothing
 * is on: the suite serves the client from its own preview server and forwards
 * these paths to the API, which is what a deployment behind a proxy does too.
 */
async function pollAsAClient(page: Page, url: string) {
  const client = await page.context().browser()!.newContext();

  try {
    const response = await client.request.get(new URL(url).pathname, {
      baseURL: new URL(page.url()).origin,
    });

    return {
      status: response.status(),
      contentType: response.headers()['content-type'],
      body: await response.text(),
    };
  } finally {
    await client.close();
  }
}

/** The address the panel shows once, which is the only time it can be read. */
async function makeFeed(page: Page, label?: string) {
  await goToScreen(page, 'Settings');

  if (label) await page.getByRole('textbox', { name: 'What it is for' }).fill(label);
  await page.getByTestId('make-calendar-feed').click();

  return page.getByTestId('calendar-feed-url').innerText();
}

test.describe('subscribing to a trip in a calendar', () => {
  test('an address serves the trip, and keeps up as the plan changes', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Kyoto, subscribed');

    await schedule(page, 'Fushimi Inari', '2026-04-15', '08:30');

    const url = await makeFeed(page, 'My phone');
    expect(url).toMatch(/\/calendar\/[\w-]+\.ics$/);

    const feed = await pollAsAClient(page, url);

    expect(feed.status).toBe(200);
    expect(feed.contentType).toBe('text/calendar; charset=utf-8');
    expect(feed.body).toContain('BEGIN:VCALENDAR');
    expect(feed.body).toContain('SUMMARY:Fushimi Inari');
    // 08:30 in Tokyo is the previous evening in UTC. Writing the instant is
    // what saves every client from having to work that out.
    expect(feed.body).toContain('DTSTART:20260414T233000Z');

    await expect(page.getByTestId('calendar-feed').filter({ hasText: 'My phone' })).toBeVisible();

    /*
     * What a subscription is for, rather than a download: an event added after
     * the address was handed out is in the next answer, with nobody sending
     * anything.
     */
    await goToScreen(page, 'Itinerary');
    await schedule(page, 'Nishiki Market', '2026-04-16', '11:00');

    expect((await pollAsAClient(page, url)).body).toContain('SUMMARY:Nishiki Market');
  });

  test('an event with no date is left out, because a calendar cannot place it', async ({
    page,
  }) => {
    await page.goto('/');
    await newTrip(page, 'Kyoto, undated');

    await schedule(page, 'Nishiki Market', '2026-04-16', '11:00');
    await addNewEvent(page, 'A pottery town, one day');
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

    const feed = await pollAsAClient(page, await makeFeed(page));

    expect(feed.body).toContain('Nishiki Market');
    expect(feed.body).not.toContain('pottery');
  });

  test('a revoked address stops answering', async ({ page }) => {
    await page.goto('/');
    await newTrip(page, 'Kyoto, revoked');

    const url = await makeFeed(page);
    expect((await pollAsAClient(page, url)).status).toBe(200);

    await page.getByTestId('calendar-feed').first().getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByTestId('calendar-feed')).toHaveCount(0);

    expect((await pollAsAClient(page, url)).status).toBe(404);
  });
});
