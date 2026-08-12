import { expect, test, type Page } from '@playwright/test';

const REDIRECT = 'http://127.0.0.1:33418/callback';

/** The PKCE pair a client would generate before opening the screen. */
async function pkce(page: Page) {
  return page.evaluate(async () => {
    const verifier = 'b'.repeat(64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return { verifier, challenge };
  });
}

async function registerClient(page: Page, name = 'A test agent') {
  return page.evaluate(async (clientName) => {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: clientName, redirectUris: ['http://127.0.0.1:33418/callback'] }),
    });
    return ((await res.json()) as { clientId: string }).clientId;
  }, name);
}

async function makeTrip(page: Page, name: string) {
  return page.evaluate(async (tripName) => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tripName, homeTimezone: 'Asia/Tokyo' }),
    });
    return ((await res.json()) as { id: string }).id;
  }, name);
}

function consentUrl(clientId: string, challenge: string, scope: string, state = 'st_1') {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  return `/connect?${query.toString()}`;
}

/*
 * Answers the agent's callback, which is a port nothing is listening on here.
 *
 * Without this the browser cannot load what it was redirected to, and a test
 * waiting for that URL waits for a page that never arrives. The redirect itself
 * is what is under test, so the far end only has to exist.
 */
test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:33418/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Connected</h1>' }),
  );
});
test('picking trips on the consent screen is what the agent ends up holding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const shared = await makeTrip(page, 'Japan, April');
  await makeTrip(page, 'Lisbon weekend');
  const clientId = await registerClient(page);
  const { verifier, challenge } = await pkce(page);

  await page.goto(consentUrl(clientId, challenge, 'trips:read trips:write'));
  await expect(page.getByRole('heading', { name: /wants to read and change your trips/ })).toBeVisible();

  // Nothing is granted until something is picked, so the button stays out.
  const allow = page.getByRole('button', { name: 'Allow' });
  await expect(allow).toBeDisabled();

  await page.getByRole('checkbox', { name: /Japan, April/ }).check();
  await expect(allow).toBeEnabled();
  await allow.click();

  await page.waitForURL(/127\.0\.0\.1:33418/);
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('st_1');

  const code = back.searchParams.get('code');
  expect(code).toBeTruthy();

  await page.goto('/');
  const trips = await page.evaluate(
    async ([authCode, verifierValue, client]) => {
      const token = (await fetch('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: 'http://127.0.0.1:33418/callback',
          client_id: client,
          code_verifier: verifierValue,
        }),
      }).then((r) => r.json())) as { access_token: string };

      const called = (await fetch('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_trips', arguments: {} },
        }),
      }).then((r) => r.json())) as { result: { content: { text: string }[] } };

      return (JSON.parse(called.result.content[0]!.text) as { trips: { id: string }[] }).trips;
    },
    [code, verifier, clientId] as const,
  );

  // The trip that was left unticked is not in the grant, so the agent cannot
  // see it however it asks.
  expect(trips.map((trip) => trip.id)).toEqual([shared]);
});

test('a read-only request cannot be widened from the screen', async ({ page }) => {
  await page.goto('/');
  await makeTrip(page, 'Japan, April');
  const clientId = await registerClient(page);
  const { challenge } = await pkce(page);

  await page.goto(consentUrl(clientId, challenge, 'trips:read'));

  await expect(page.getByRole('heading', { name: /wants to read your trips/ })).toBeVisible();
  await expect(page.getByText('It asked to read only, so it cannot change anything.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Let it make changes/ })).toHaveCount(0);
});

test('cancelling sends the client away with access_denied', async ({ page }) => {
  await page.goto('/');
  await makeTrip(page, 'Japan, April');
  const clientId = await registerClient(page);
  const { challenge } = await pkce(page);

  await page.goto(consentUrl(clientId, challenge, 'trips:read', 'st_2'));
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.waitForURL(/127\.0\.0\.1:33418/);
  const back = new URL(page.url());
  expect(back.searchParams.get('error')).toBe('access_denied');
  expect(back.searchParams.get('state')).toBe('st_2');
  expect(back.searchParams.get('code')).toBeNull();
});

test('an agent made in the app can then be connected to a trip', async ({ page }) => {
  await page.goto('/');
  // The list renders once the browser knows who it is. Creating a trip before
  // that would race the request that settles it, and land on another identity.
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const tripId = await makeTrip(page, 'Japan, April');

  await page.getByRole('link', { name: 'Agents' }).click();
  await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();

  await page.getByRole('textbox', { name: 'Name' }).fill('Gemini Spark');
  await page.getByRole('textbox', { name: 'Redirect address' }).fill(REDIRECT);
  // Loopback, so it cannot keep a secret; that is the public-client case.
  await page.getByRole('checkbox', { name: /It runs on a server/ }).uncheck();
  await page.getByRole('button', { name: 'Create agent' }).click();

  const credentials = page.getByTestId('new-agent-credentials');
  await expect(credentials).toBeVisible();

  const clientId = (await credentials.locator('code').first().textContent())!.trim();
  expect(clientId).toMatch(/^mcp_/);

  await expect(page.getByTestId('agent-clients')).toContainText('Gemini Spark');

  // And it is a working client: the consent screen accepts it straight away.
  const { challenge } = await pkce(page);
  await page.goto(consentUrl(clientId, challenge, 'trips:read'));
  await expect(page.getByRole('heading', { name: /Gemini Spark wants to read/ })).toBeVisible();

  await page.getByRole('checkbox', { name: /Japan, April/ }).check();
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(/127\.0\.0\.1:33418/);
  expect(new URL(page.url()).searchParams.get('code')).toBeTruthy();

  expect(tripId).toBeTruthy();
});

test('removing an agent takes it out of the list', async ({ page }) => {
  await page.goto('/agents');

  await page.getByRole('textbox', { name: 'Name' }).fill('Short lived');
  await page.getByRole('textbox', { name: 'Redirect address' }).fill('https://agent.example/cb');
  await page.getByRole('button', { name: 'Create agent' }).click();

  await expect(page.getByTestId('agent-clients')).toContainText('Short lived');

  await page.getByRole('button', { name: 'Remove Short lived' }).click();
  await expect(page.getByText('None yet.')).toBeVisible();
});

/*
 * Answered in the browser rather than by shutting the real server. One server
 * serves the whole suite, and the harness holds the only admin session on it,
 * so closing it here would take every other test down with it. What the server
 * does about a closed door is covered by the API tests; this is about what the
 * person in front of it is shown.
 */
test('a stranger meeting a closed server is told, and a share link still opens', async ({
  page,
}) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'registration_closed' }),
    }),
  );

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'This server is not taking new people' }),
  ).toBeVisible();

  /*
   * The join route has to render for exactly the person the door was shut on,
   * because redeeming the link is what gives them an account. Showing them the
   * closed screen instead would make every share link useless.
   */
  await page.goto('/join/a-token-that-goes-nowhere');
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
});

test('an unregistered client is refused before anything is asked', async ({ page }) => {
  await page.goto('/');
  const { challenge } = await pkce(page);

  await page.goto(consentUrl('mcp_never_registered', challenge, 'trips:read'));

  await expect(page.getByRole('heading', { name: 'This connection was refused' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
});
