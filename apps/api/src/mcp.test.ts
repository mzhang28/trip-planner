import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { auditLog } from '@trip/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { FsBlobStore } from './blobs/FsBlobStore';
import { createDb, runMigrations, type Db } from './db';
import { DocStore } from './docStore';

type App = ReturnType<typeof createApp>;

const REDIRECT = 'http://127.0.0.1:33418/callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** A browser: a cookie jar, which is what the consent screen runs in. */
class Browser {
  cookie = '';

  constructor(private readonly app: App) {}

  async request(path: string, init: RequestInit = {}) {
    const res = await this.app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...init.headers,
      },
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;

    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
}

async function rpc(app: App, accessToken: string, method: string, params?: unknown) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('the remote MCP server', () => {
  let app: App;
  let db: Db;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-mcp-blobs') });
  });

  /** Registers, consents, and exchanges a code — the whole flow a client runs. */
  async function connect(scope = 'trips:read trips:write') {
    const browser = new Browser(app);

    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });

    const registered = await browser.request('/oauth/register', {
      method: 'POST',
      body: JSON.stringify({ client_name: 'An agent', redirect_uris: [REDIRECT] }),
    });
    expect(registered.status).toBe(201);

    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: registered.body.client_id,
        redirect_uri: REDIRECT,
        scope,
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });
    expect(consent.status).toBe(200);

    const code = new URL(consent.body.redirect_to).searchParams.get('code')!;

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: registered.body.client_id,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);

    return {
      browser,
      tripId: trip.body.id as string,
      clientId: registered.body.client_id as string,
      accessToken: token.body.access_token as string,
      refreshToken: token.body.refresh_token as string,
      verifier,
      code,
    };
  }

  it('tells an unauthenticated caller where to get a token', async () => {
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });

    expect(res.status).toBe(401);
    // The hint is how a client discovers the authorization server at all.
    expect(res.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
  });

  it('publishes both discovery documents', async () => {
    const resource = await app.request('/.well-known/oauth-protected-resource');
    expect(resource.status).toBe(200);
    expect(((await resource.json()) as { authorization_servers: string[] }).authorization_servers).toHaveLength(1);

    const server = await app.request('/.well-known/oauth-authorization-server');
    const metadata = (await server.json()) as Record<string, string[]>;

    // S256 only: `plain` gives no protection against an intercepted code.
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.grant_types_supported).toContain('refresh_token');
  });

  it('lists its tools and runs one', async () => {
    const { accessToken, tripId } = await connect();

    const listed = await rpc(app, accessToken, 'tools/list');
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).toContain('create_event');

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari at dawn', city: 'Kyoto' },
    });
    expect(created.body.result.isError).toBeUndefined();

    const events = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId },
    });
    expect(events.body.result.content[0].text).toContain('Fushimi Inari at dawn');
  });

  it('takes a time as an ISO string as well as an epoch', async () => {
    const { accessToken, tripId } = await connect();

    // A model writing an offset date is likelier to be right than one doing
    // epoch arithmetic, so refusing this form would cost a round trip.
    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Flight', startsAt: '2026-08-14T09:00:00+09:00' },
    });
    expect(created.body.result.isError).toBeUndefined();

    const events = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId },
    });
    expect(events.body.result.content[0].text).toContain(String(Date.UTC(2026, 7, 14, 0, 0)));
  });

  it('refuses a trip the client was never granted', async () => {
    const { accessToken } = await connect();

    const result = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId: 't_somebody_elses' },
    });

    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.content[0].text).toContain('not granted');
  });

  it('refuses a write when the grant was read-only', async () => {
    const { accessToken, tripId } = await connect('trips:read');

    const result = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Should not appear' },
    });

    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.content[0].text).toContain('read-only');
  });

  it('records who did what, through which client', async () => {
    const { accessToken, tripId, clientId } = await connect();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari' },
    });

    const rows = db.select().from(auditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'mcp', clientId, toolName: 'create_event' });
    // Named in words, because the panel is read by a person deciding whether to
    // undo it rather than by the thing that wrote it.
    expect(rows[0]!.summary).toContain('Fushimi Inari');
  });

  it('captures what an update replaced, so it can be put back', async () => {
    const { accessToken, tripId } = await connect();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari', city: 'Kyoto' },
    });
    const eventId = JSON.parse(created.body.result.content[0].text).eventId;

    const updated = await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, city: 'Osaka' },
    });
    expect(updated.body.result.isError, updated.body.result.content[0].text).toBeUndefined();

    // The fields the caller did not mention are untouched. Sending the whole
    // set with most of them undefined would clear them, since an undefined
    // value is how the editor empties a box.
    const after = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });
    const event = JSON.parse(after.body.result.content[0].text).event;
    expect(event.name).toBe('Fushimi Inari');
    expect(event.city).toBe('Osaka');

    const update = db.select().from(auditLog).all().at(-1)!;
    const before = JSON.parse(update.beforeJson!);

    // Only the touched field is captured, so undoing this cannot revert
    // something somebody else changed in the meantime.
    expect(before).toEqual({ city: 'Kyoto' });
  });

  it('serves the itinerary as markdown', async () => {
    const { accessToken, tripId } = await connect();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari', startsAt: '2026-08-14T09:00:00+09:00' },
    });

    const read = await rpc(app, accessToken, 'resources/read', {
      uri: `trip://${tripId}/itinerary`,
    });

    expect(read.body.result.contents[0].text).toContain('# Japan, April');
    expect(read.body.result.contents[0].text).toContain('Fushimi Inari');
  });
});

describe('the OAuth server', () => {
  let app: App;
  let db: Db;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-mcp-blobs') });
  });

  async function register(browser: Browser, redirectUris = [REDIRECT]) {
    const res = await browser.request('/oauth/register', {
      method: 'POST',
      body: JSON.stringify({ client_name: 'An agent', redirect_uris: redirectUris }),
    });
    return res.body.client_id as string;
  }

  async function authorize(browser: Browser, clientId: string, challenge: string, tripIds: string[]) {
    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:read',
        code_challenge: challenge,
        trip_ids: tripIds,
      }),
    });
    return new URL(consent.body.redirect_to).searchParams.get('code')!;
  }

  it('refuses a code redeemed twice', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const body = JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });

    expect((await browser.request('/oauth/token', { method: 'POST', body })).status).toBe(200);
    // A code that works twice is a code an eavesdropper can also use.
    expect((await browser.request('/oauth/token', { method: 'POST', body })).status).toBe(400);
  });

  it('refuses a mismatched PKCE verifier', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const result = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: pkce().verifier,
      }),
    });

    expect(result.status).toBe(400);
    expect(result.body.error_description).toContain('PKCE');
  });

  it('refuses a redirect the client never registered', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const result = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: 'https://somewhere-else.example/steal',
        scope: 'trips:read',
        code_challenge: pkce().challenge,
        trip_ids: [],
      }),
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_redirect_uri');
  });

  it('grants only trips the person actually holds', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();

    // Naming somebody else's trip in the request must not grant it, or the
    // consent screen would be describing one thing and authorising another.
    const code = await authorize(browser, clientId, challenge, ['t_not_mine']);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    const listed = await rpc(app, token.body.access_token, 'tools/call', {
      name: 'list_trips',
      arguments: {},
    });

    expect(JSON.parse(listed.body.result.content[0].text).trips).toEqual([]);
  });

  it('rotates refresh tokens and revokes the family when one is reused', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const first = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    const refreshOnce = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });

    const second = await browser.request('/oauth/token', { method: 'POST', body: refreshOnce });
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.body.refresh_token);

    /*
     * Presenting the old one again means it leaked: the legitimate holder has
     * the newer one. Which of the two callers is the attacker cannot be known,
     * so the whole family goes and both have to start again.
     */
    const replay = await browser.request('/oauth/token', { method: 'POST', body: refreshOnce });
    expect(replay.status).toBe(400);
    expect(replay.body.error_description).toContain('reuse');

    const afterReuse = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: second.body.refresh_token,
        client_id: clientId,
      }),
    });
    expect(afterReuse.status).toBe(400);
  });

  it('stops working once the token is revoked', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    expect((await rpc(app, token.body.access_token, 'tools/list')).status).toBe(200);

    const form = new FormData();
    form.set('token', token.body.access_token);
    await app.request('/oauth/revoke', { method: 'POST', body: form });

    expect((await rpc(app, token.body.access_token, 'tools/list')).status).toBe(401);
  });
});
