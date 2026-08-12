import { expect, test, type Page } from '@playwright/test';

async function newTrip(page: Page) {
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const trip = await page.evaluate(async () => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });
    return (await res.json()) as { id: string };
  });

  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  return trip.id;
}

async function addEvent(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'New event' }).fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('event').filter({ hasText: name }).click();
  await expect(page.getByTestId('event-editor')).toBeVisible();

  // Files are behind their chip until the event has one.
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId('add-field-files').count()) === 0) {
    await editor.getByTestId('expand-palette').click();
  }
  await editor.getByTestId('add-field-files').click();
}

const FILE = {
  name: 'booking.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('Confirmation 7K2QLM'),
};

test.describe('attachments', () => {
  test('a file attached online is uploaded and can be downloaded back', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);
    await addEvent(page, 'Ryokan');

    await page.getByTestId('attachment-input').setInputFiles(FILE);

    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();
    await expect(page.getByText('Waiting to send')).toHaveCount(0);

    // The bytes came back, which is the only thing that proves it was stored.
    const href = await page.getByRole('link', { name: 'booking.txt' }).getAttribute('href');
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('Confirmation 7K2QLM');
  });

  test('a file attached with no network is kept and sent on reconnect', async ({ page, context }) => {
    await page.goto('/');
    await newTrip(page);
    await addEvent(page, 'Ryokan');

    await context.setOffline(true);
    await page.getByTestId('attachment-input').setInputFiles(FILE);

    // On the event straight away, and honest about not having gone anywhere.
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();
    await expect(page.getByText('Waiting to send')).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

    const href = await page.getByRole('link', { name: 'booking.txt' }).getAttribute('href');
    await expect
      .poll(async () => (await page.request.get(href!)).status(), { timeout: 15_000 })
      .toBe(200);
  });

  test('removing a file takes it off the event', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);
    await addEvent(page, 'Ryokan');

    await page.getByTestId('attachment-input').setInputFiles(FILE);
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove booking.txt' }).click();
    await expect(page.getByRole('link', { name: 'booking.txt' })).toHaveCount(0);
  });
});
