import { defineConfig, devices } from '@playwright/test';

const WEB_URL = process.env.E2E_BASE_URL;
if (!WEB_URL) throw new Error('No E2E server is running. Start tests with `pnpm test:e2e`.');

/*
 * Behaviour is covered once on desktop. Tests tagged @responsive also run on
 * phone and tablet, where width, touch, or mobile browser behaviour can change
 * the result. Running every data and workflow test at all three sizes tripled
 * the suite without exercising a different code path.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  /*
   * One API process serves the whole suite, and better-sqlite3 is synchronous,
   * so every request it handles blocks the next. Past four workers the tests
   * spend their time queueing behind each other and start timing out on work
   * that is not slow, only waiting.
   */
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',

    /*
     * Times are shown on the clock the visitor's locale uses, so an unpinned
     * browser would read 09:00 or 9:00 AM depending on the machine the suite
     * runs on. Pinned here to the 24-hour reading the assertions below are
     * written in; the twelve-hour one has a test of its own.
     */
    locale: 'en-GB',
  },

  /*
   * All three run on Chromium. The tablet is an iPad-sized viewport with touch
   * rather than the built-in iPad device, which would pull in WebKit for a
   * layout question that is about width and pointer type, not about the engine.
   */
  projects: [
    { name: 'phone', grep: /@(responsive|touch)/, use: { ...devices['Pixel 7'] } },
    {
      name: 'tablet',
      grep: /@(responsive|touch)/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'desktop',
      grepInvert: /@touch/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

});
