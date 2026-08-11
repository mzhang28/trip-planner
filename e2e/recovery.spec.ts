import { expect, test } from '@playwright/test';

test('work made while away is kept when the trip has to be reloaded', async ({ page, context }) => {
  await page.goto('/');
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

  await page.getByRole('textbox', { name: 'New event' }).fill('Booked before the sweep');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('event')).toHaveCount(1);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

  // Go away, plan something, and come back after the server has swept. The
  // server will refuse this document: it predates the sweep and could put
  // deleted events back.
  await context.setOffline(true);
  await page.getByRole('textbox', { name: 'New event' }).fill('Added while away');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('event')).toHaveCount(2);

  await context.setOffline(false);
  // The server now refuses anything older than this moment, which is what a
  // device that has been away past the tombstone horizon looks like.
  await page.request.post(`/api/test/force-resync/${trip.id}`);

  await page.reload();

  const banner = page.getByTestId('recovery-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText('had not been sent');

  // Nothing is lost by default, and putting it back restores what was made.
  await banner.getByRole('button', { name: /Put .* back/ }).click();
  await expect(page.getByTestId('event').filter({ hasText: 'Added while away' })).toBeVisible();
  await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
});
