import { expect, test, type Page } from '@playwright/test';
import { addNewEvent, editEvent } from './helpers';

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
  await addNewEvent(page, name);
  await editEvent(page, name);

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

    // Compact content indicators stay on the day card when its editor closes.
    const editor = page.getByTestId('event-editor');
    if ((await editor.getByTestId('add-field-description').count()) === 0) {
      await editor.getByTestId('expand-palette').click();
    }
    await editor.getByTestId('add-field-description').click();
    const description = editor.getByRole('combobox', { name: 'Description' });
    await description.fill('Show the confirmation at check-in.');
    await description.blur();
    await page.getByTestId('close-editor').click();

    const row = page.getByTestId('event').filter({ hasText: 'Ryokan' });
    await expect(row.getByTestId('attachment-indicator')).toBeVisible();
    await expect(row.getByTestId('description-indicator')).toBeVisible();
  });

  test('a file attached with no network is kept and sent on reconnect', async ({
    page,
    context,
  }) => {
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

  test('a trip file can be reused on multiple events', async ({ page }) => {
    await page.goto('/');
    const tripId = await newTrip(page);

    await page.goto(`/t/${tripId}/files`);
    await page.getByTestId('file-upload-input').setInputFiles(FILE);
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();

    await page.goto(`/t/${tripId}`);
    await addEvent(page, 'Ryokan');
    await page.getByTestId('open-file-picker').click();
    await page
      .getByRole('dialog', { name: 'Add a file' })
      .getByRole('button', { name: /booking\.txt/ })
      .click();
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();

    await page.getByTestId('close-editor').click();
    await addEvent(page, 'Flight');
    await page.getByTestId('open-file-picker').click();
    await page
      .getByRole('dialog', { name: 'Add a file' })
      .getByRole('button', { name: /booking\.txt/ })
      .click();
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();

    await page.goto(`/t/${tripId}/files`);
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();
    await expect(page.getByText('2 events')).toBeVisible();
  });
});
