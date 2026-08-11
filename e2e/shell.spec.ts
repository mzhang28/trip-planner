import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test('loads and applies a theme before anything is painted', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Trip Planner' })).toBeVisible();

    // The inline script in index.html has to have run, otherwise a dark-theme
    // user gets a white flash on every load.
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toMatch(/^(light|dark)$/);
  });

  test('the theme control switches the page and survives a reload', async ({ page }) => {
    await page.goto('/');

    /*
     * Click the label, not the radio. React Aria hides the real input under the
     * label that styles it, so a click aimed at the input is intercepted — the
     * same way it would be for a person, who clicks the word "Dark".
     */
    const theme = page.getByRole('radiogroup', { name: 'Theme' });
    await theme.getByText('Dark', { exact: true }).click();

    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  test('says so when the device goes offline', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByText('Online')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText(/Offline/)).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText('Online')).toBeVisible();
  });
});
