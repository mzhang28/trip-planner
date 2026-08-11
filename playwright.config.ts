import { defineConfig, devices } from '@playwright/test';

/*
 * Tests run on their own pair of ports, beside the dev server on 5173/8787
 * rather than instead of it. Nobody has to stop what they are doing to run the
 * suite.
 */
const API_PORT = process.env.API_PORT ?? '8887';
const WEB_PORT = process.env.WEB_PORT ?? '5273';
const WEB_URL = `http://localhost:${WEB_PORT}`;

/*
 * Three viewports, because the layouts differ rather than merely reflow: the
 * week view scrolls sideways on a phone and fits on a desktop, and the day view
 * puts the map beside the timeline only from tablet up.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /*
   * All three run on Chromium. The tablet is an iPad-sized viewport with touch
   * rather than the built-in iPad device, which would pull in WebKit for a
   * layout question that is about width and pointer type, not about the engine.
   */
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @trip/api dev',
      env: { PORT: API_PORT, DATABASE_PATH: 'data/test.db' },
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Built and previewed rather than run from the dev server, so the service
      // worker under test is the one that ships. In dev, Vite serves unbundled
      // modules the worker never precaches, and an offline reload fails for a
      // reason that does not exist in the built app.
      command: 'pnpm --filter @trip/web build && pnpm --filter @trip/web preview',
      env: { WEB_PORT, API_PORT },
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
