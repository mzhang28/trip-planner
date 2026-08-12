import { expect, test, type Page } from '@playwright/test';
import { addNewEvent } from './helpers';

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

const FILE = {
  name: 'booking.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('Confirmation 7K2QLM'),
};

test.describe('exporting and importing a trip', () => {
  test('a trip downloaded as a zip comes back with its attachments', async ({ page }) => {
    await page.goto('/');
    const tripId = await newTrip(page, 'Kyoto, export');

    await addNewEvent(page, 'Fushimi Inari');
    await page.getByTestId('event').filter({ hasText: 'Fushimi Inari' }).click();
    await expect(page.getByTestId('event-editor')).toBeVisible();

    const editor = page.getByTestId('event-editor');
    if ((await editor.getByTestId('add-field-files').count()) === 0) {
      await editor.getByTestId('expand-palette').click();
    }
    await editor.getByTestId('add-field-files').click();
    await page.getByTestId('attachment-input').setInputFiles(FILE);

    // The bytes have to be on the server before the export can pack them.
    await expect(page.getByRole('link', { name: 'booking.txt' })).toBeVisible();
    await expect(page.getByText('Waiting to send')).toHaveCount(0);
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

    await page.goto(`/t/${tripId}/fields`);

    const download = page.waitForEvent('download');
    await page.getByTestId('export-trip').click();
    const archive = await download;

    // Named after the trip and the day, so a month of backups sorts and does
    // not overwrite itself.
    expect(archive.suggestedFilename()).toMatch(/^Kyoto,-export-\d{4}-\d{2}-\d{2}\.zip$/);

    const archivePath = await archive.path();

    await page.goto('/');
    await page.getByTestId('import-trip-input').setInputFiles(archivePath);

    /*
     * The import opens the trip it made. It is a copy: a new id, sitting beside
     * the trip it came from rather than replacing it.
     */
    await page.waitForURL(/\/t\/t_/, { timeout: 15_000 });
    expect(page.url()).not.toContain(tripId);
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
    await expect(page.getByTestId('event').filter({ hasText: 'Fushimi Inari' })).toBeVisible();

    await page.getByTestId('event').filter({ hasText: 'Fushimi Inari' }).click();
    const attachment = page.getByTestId('event-editor').getByRole('link', { name: 'booking.txt' });
    await expect(attachment).toBeVisible();

    // The link has to answer with the bytes, not with a 404: an attachment that
    // is listed and will not download is worse than one that did not travel.
    const href = await attachment.getAttribute('href');
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('Confirmation 7K2QLM');

    await page.goto('/');
    await expect(page.getByRole('link', { name: /Kyoto, export/ })).toHaveCount(2);
  });

  test('a file that is not an archive is refused, and says so', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

    await page.getByTestId('import-trip-input').setInputFiles({
      name: 'holiday.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('not a zip at all'),
    });

    await expect(page.getByTestId('import-problem')).toHaveText('That file is not a trip archive.');
  });
});
