import { expect, test } from '@playwright/test';
import { addNewEvent } from './helpers';

test('a lodging label follows a wide visible remainder and leaves a short one alone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();
  const trip = await page.evaluate(async () => {
    const response = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Long stay', homeTimezone: 'Asia/Tokyo' }),
    });
    return (await response.json()) as { id: string };
  });
  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('trip-start-date').fill('2026-08-01');
  await page.getByTestId('trip-end-date').fill('2026-09-15');
  await page.getByRole('link', { name: 'Itinerary', exact: true }).click();

  await addNewEvent(page, 'A deliberately named long hotel');
  await page
    .getByTestId('event')
    .filter({ hasText: 'A deliberately named long hotel' })
    .click();
  await page.getByTestId('event-kind-button').click();
  await page
    .getByRole('dialog', { name: 'Event kind' })
    .getByRole('button', { name: 'Stay' })
    .click();
  await page.getByTestId('check-in').fill('2026-08-05');
  await page.getByTestId('check-out').fill('2026-08-25');
  await page.getByTestId('close-editor').click();
  await page
    .getByRole('radiogroup', { name: 'Calendar view' })
    .getByText('Week', { exact: true })
    .click();

  const scroller = page.getByTestId('week-horizontal-scroll');
  const hotel = page.getByTestId('week-lodging');
  const label = hotel.getByTestId('week-lodging-label');
  await scroller.evaluate((node) => {
    const bar = node.querySelector<HTMLElement>('[data-testid="week-lodging"]')!;
    const viewport = node.getBoundingClientRect();
    const rect = bar.getBoundingClientRect();
    node.scrollLeft += rect.left - viewport.left - 40 + 80;
  });
  await expect(label).toHaveAttribute('data-visible', 'true');
  const [scrollerBox, labelBox] = await Promise.all([scroller.boundingBox(), label.boundingBox()]);
  if (!scrollerBox || !labelBox) throw new Error('no lodging rail bounds');
  expect(labelBox.x).toBeCloseTo(scrollerBox.x + 48, 0);

  await scroller.evaluate((node) => {
    const bar = node.querySelector<HTMLElement>('[data-testid="week-lodging"]')!;
    const label = bar.querySelector<HTMLElement>('[data-testid="week-lodging-label"]')!;
    const viewport = node.getBoundingClientRect();
    const rect = bar.getBoundingClientRect();
    node.scrollLeft += rect.right - (viewport.left + 40) - label.offsetWidth + 16;
  });
  await expect(label).toHaveAttribute('data-visible', 'false');
});
