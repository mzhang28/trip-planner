import { expect, test } from '@playwright/test';

/**
 * What the settings screen says about the copy of the app that is installed.
 *
 * Run against the built app, which is the only place the service worker exists
 * to be asked -- so this covers the same path a phone with the app on its home
 * screen takes when somebody wonders whether they are behind.
 */
test.describe('the installed version', () => {
  test('names the build it is running, and finds nothing newer to install', async ({ page }) => {
    await page.goto('/settings');

    // The stamp vite wrote into the bundle: a time, and the commit when the
    // machine that built it had one to read.
    await expect(page.getByTestId('app-version')).not.toBeEmpty();

    // Asked on arrival, without the button being pressed. Nothing has been
    // deployed since this build, because this build is what is being served.
    await expect(page.getByTestId('update-state')).toHaveText(/Up to date/, { timeout: 15_000 });
  });

  test('says so when there is no network to check over', async ({ page, context }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('update-state')).toHaveText(/Up to date/, { timeout: 15_000 });

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Check for updates' }).click();

    /*
     * Not "up to date", which would be a guess. The worker's own request for a
     * new version does not go through the page, so with the network cut it can
     * come back reporting nothing new -- which is why the app looks at whether
     * there is a network before it asks.
     */
    await expect(page.getByTestId('update-state')).toHaveText(/No network/, { timeout: 15_000 });
  });
});
