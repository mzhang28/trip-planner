import { expect, test, type Page } from '@playwright/test';

/**
 * Connects an agent the way a real client would: register, consent, exchange.
 *
 * Driven from the page so it shares the browser's session, which is what the
 * consent screen decides against.
 */
async function connectAgent(page: Page, tripId: string) {
  return page.evaluate(async (id) => {
    const json = (path: string, body: unknown) =>
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    const client = (await json('/oauth/register', {
      client_name: 'A test agent',
      redirect_uris: ['http://127.0.0.1:33418/callback'],
    })) as { client_id: string };

    const verifier = 'a'.repeat(64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const consent = (await json('/oauth/authorize/consent', {
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:33418/callback',
      scope: 'trips:read trips:write',
      code_challenge: challenge,
      trip_ids: [id],
    })) as { redirect_to: string };

    const token = (await json('/oauth/token', {
      grant_type: 'authorization_code',
      code: new URL(consent.redirect_to).searchParams.get('code'),
      redirect_uri: 'http://127.0.0.1:33418/callback',
      client_id: client.client_id,
      code_verifier: verifier,
    })) as { access_token: string };

    return token.access_token;
  }, tripId);
}

async function callTool(page: Page, token: string, name: string, args: unknown) {
  return page.evaluate(
    async ([accessToken, toolName, toolArgs]) => {
      const res = await fetch('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: toolArgs },
        }),
      });
      return res.json();
    },
    [token, name, args] as const,
  );
}

test('what an agent did is listed, and can be undone from the app', async ({ page }) => {
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

  const token = await connectAgent(page, trip.id);
  await callTool(page, token, 'create_event', { tripId: trip.id, name: 'Agent booked this' });

  // It reaches the trip through the ordinary sync, with nothing special done.
  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('event').filter({ hasText: 'Agent booked this' })).toBeVisible();

  await page.goto(`/t/${trip.id}/fields`);
  await expect(page.getByText('Agent booked this')).toBeVisible();
  await expect(page.getByText(/through an agent/)).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/undone/)).toBeVisible();

  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('event').filter({ hasText: 'Agent booked this' })).toHaveCount(0);
});
