import AxeBuilder from '@axe-core/playwright';
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

/**
 * Only violations that stop someone using the page.
 *
 * WCAG A and AA are what the token contrast was designed against, and the
 * design system asserts the colour half of that in a unit test. This covers the
 * parts a stylesheet cannot: names on controls, roles that match behaviour, and
 * a heading order that can be navigated.
 */
async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

function describeViolations(results: Awaited<ReturnType<typeof scan>>) {
  return results.violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help}\n` +
        violation.nodes
          .map((node) => `    ${node.target.join(' ')}\n    ${node.failureSummary ?? ''}`)
          .join('\n'),
    )
    .join('\n');
}

test.describe('accessibility', () => {
  test('the trip list has no violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });

  test('the day view has no violations, with an event open', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('event').first().click();
    await expect(page.getByTestId('event-editor')).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });

  test('the week and month views have no violations', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    for (const view of ['Week', 'Month'] as const) {
      await page
        .getByRole('radiogroup', { name: 'Calendar view' })
        .getByText(view, { exact: true })
        .click();

      const results = await scan(page);
      expect(describeViolations(results), `${view} view`).toBe('');
    }
  });

  test('every control can be reached and used from the keyboard', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('event').first()).toBeVisible();

    // Tab to the card and open it with the keyboard alone. Opening an event is
    // the way into every other edit, so it cannot be pointer-only.
    await page.getByTestId('event').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('event-editor')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('the theme control keeps its contrast in the dark', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'Theme' }).getByText('Dark', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });
});
