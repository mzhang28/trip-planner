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

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'An agent', redirectUris: [REDIRECT] }),
    });
    expect(registered.status).toBe(201);

    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: registered.body.clientId,
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
        client_id: registered.body.clientId,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);

    return {
      browser,
      tripId: trip.body.id as string,
      clientId: registered.body.clientId as string,
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
    // Credentials are only handed to a browser that has been here before, so
    // settle an identity first. The app does the same on its first paint.
    await browser.request('/api/me');

    const res = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'An agent', redirectUris }),
    });
    return res.body.clientId as string;
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

  /** The query a client sends when it opens the consent screen in a browser. */
  function authorizeQuery(clientId: string, challenge: string, scope = 'trips:read') {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
  }

  it('describes the request for the consent screen to render', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);

    const result = await browser.request(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge, 'trips:read trips:write')}`,
    );

    expect(result.status).toBe(200);
    expect(result.body.client.name).toBe('An agent');
    expect(result.body.client.redirectOrigin).toBe('http://127.0.0.1:33418');
    expect(result.body.scope).toBe('trips:read trips:write');
    expect(result.body.trips.map((t: { id: string }) => t.id)).toEqual([trip.body.id]);
    expect(result.body.you.userId).toMatch(/^u_/);
  });

  it('offers only the trips the person signed in holds', async () => {
    const owner = new Browser(app);
    await owner.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Not yours', homeTimezone: 'UTC' }),
    });

    // A second browser is a second person. The screen they are shown must
    // describe their own trips, not whoever registered the client.
    const stranger = new Browser(app);
    const clientId = await register(stranger);
    const result = await stranger.request(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge)}`,
    );

    expect(result.status).toBe(200);
    expect(result.body.trips).toEqual([]);
  });

  it('refuses a scope this server does not have', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const asked = await browser.request(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge, 'trips:read trips:delete')}`,
    );
    expect(asked.status).toBe(400);
    expect(asked.body.error).toBe('invalid_scope');

    // And again at the point it would be written into a grant, so a client
    // posting straight past the screen cannot smuggle one in.
    const consented = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:delete',
        code_challenge: pkce().challenge,
        trip_ids: [],
      }),
    });
    expect(consented.status).toBe(400);
    expect(consented.body.error).toBe('invalid_scope');
  });

  it('sends the client back with access_denied when the person says no', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const result = await browser.request('/oauth/authorize/deny', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, redirect_uri: REDIRECT, state: 'abc' }),
    });

    expect(result.status).toBe(200);
    const back = new URL(result.body.redirect_to);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('abc');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it('will not send a refusal to a redirect the client never registered', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const result = await browser.request('/oauth/authorize/deny', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: 'https://somewhere-else.example/steal',
      }),
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_redirect_uri');
  });

  it('makes a client that registered a secret present it', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A server-side agent',
        redirectUris: [REDIRECT],
        confidential: true,
      }),
    });
    const clientId = registered.body.clientId as string;
    const secret = registered.body.clientSecret as string;
    expect(secret).toBeTruthy();

    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const grant = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    };

    const withoutSecret = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify(grant),
    });
    expect(withoutSecret.status).toBe(401);
    expect(withoutSecret.body.error).toBe('invalid_client');

    const withSecret = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({ ...grant, client_secret: secret }),
    });
    expect(withSecret.status).toBe(200);
    expect(withSecret.body.access_token).toBeTruthy();
  });

  it('refuses to register a plain HTTP redirect that leaves the machine', async () => {
    const browser = new Browser(app);
    await browser.request('/api/me');

    const remote = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: ['http://agent.example/callback'],
      }),
    });
    expect(remote.status).toBe(400);

    // The same URI over TLS is what a hosted client should be registering.
    const secure = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: ['https://agent.example/callback'],
      }),
    });
    expect(secure.status).toBe(201);
  });

  it('connects a hosted client that keeps a secret and an https redirect', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const hostedRedirect = 'https://agent.example/oauth/callback';
    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: [hostedRedirect],
        confidential: true,
      }),
    });

    const clientId = registered.body.clientId as string;
    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: hostedRedirect,
        scope: 'trips:read trips:write',
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });
    expect(consent.status).toBe(200);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: hostedRedirect,
        client_id: clientId,
        client_secret: registered.body.clientSecret,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);

    const listed = await rpc(app, token.body.access_token, 'tools/call', {
      name: 'list_trips',
      arguments: {},
    });
    expect(JSON.parse(listed.body.result.content[0].text).trips).toHaveLength(1);
  });

  it('will not let a hosted client swap in another host at the redirect', async () => {
    const browser = new Browser(app);
    await browser.request('/api/me');

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: ['https://agent.example/oauth/callback'],
      }),
    });

    // Off-loopback URIs match exactly, so a path or host the client did not
    // register is refused however close it looks.
    for (const uri of [
      'https://agent.example.evil/oauth/callback',
      'https://agent.example/oauth/callback/../../steal',
      'https://evil.example/oauth/callback',
    ]) {
      const result = await browser.request('/oauth/authorize/consent', {
        method: 'POST',
        body: JSON.stringify({
          client_id: registered.body.clientId,
          redirect_uri: uri,
          scope: 'trips:read',
          code_challenge: pkce().challenge,
          trip_ids: [],
        }),
      });

      expect(result.status, uri).toBe(400);
      expect(result.body.error).toBe('invalid_redirect_uri');
    }
  });

  it('will not hand credentials to a request that arrived without a session', async () => {
    // No cookie jar: a bare POST, the way anything on the internet would reach
    // it. `withIdentity` would otherwise mint a person and treat it as them.
    const result = await app.request('/api/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Uninvited', redirectUris: ['https://agent.example/cb'] }),
    });

    expect(result.status).toBe(401);
    expect(((await result.json()) as { error: string }).error).toBe('not_signed_in');
  });

  it('no longer advertises a registration endpoint for agents to use', async () => {
    const metadata = await app.request('/.well-known/oauth-authorization-server');
    const body = (await metadata.json()) as Record<string, unknown>;

    expect(body.registration_endpoint).toBeUndefined();
    expect(body.token_endpoint).toBeTruthy();
  });

  it('lists only the clients you made, and forgets them when you say so', async () => {
    const mine = new Browser(app);
    const clientId = await register(mine);

    const listed = await mine.request('/api/clients');
    expect(listed.body.clients.map((c: { clientId: string }) => c.clientId)).toEqual([clientId]);

    // Somebody else's list is their own, and their delete does not reach it.
    const stranger = new Browser(app);
    await stranger.request('/api/me');
    expect((await stranger.request('/api/clients')).body.clients).toEqual([]);
    expect((await stranger.request(`/api/clients/${clientId}`, { method: 'DELETE' })).status).toBe(404);

    expect((await mine.request(`/api/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await mine.request('/api/clients')).body.clients).toEqual([]);
  });

  it('stops an agent working the moment its client is taken away', async () => {
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

    const accessToken = token.body.access_token as string;
    expect((await rpc(app, accessToken, 'tools/list')).status).toBe(200);

    expect((await browser.request(`/api/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200);

    /*
     * Nothing on the MCP path reads the client table, so deleting the row alone
     * would leave the token working until it expired an hour later.
     */
    expect((await rpc(app, accessToken, 'tools/list')).status).toBe(401);
  });

  it('points clients at the consent screen, not at the endpoint behind it', async () => {
    const metadata = await app.request('/.well-known/oauth-authorization-server');
    const body = (await metadata.json()) as Record<string, string>;

    // A browser sent to /oauth/authorize is shown JSON, which is not a screen
    // anyone can approve anything on.
    expect(new URL(body.authorization_endpoint!).pathname).toBe('/connect');
  });
});

describe('undoing what an agent did', () => {
  let app: App;
  let db: Db;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-mcp-blobs') });
  });

  async function setup() {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'An agent', redirectUris: [REDIRECT] }),
    });
    const { verifier, challenge } = pkce();
    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: registered.body.clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:read trips:write',
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });
    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: REDIRECT,
        client_id: registered.body.clientId,
        code_verifier: verifier,
      }),
    });

    return { browser, tripId: trip.body.id as string, accessToken: token.body.access_token as string };
  }

  it('puts back the value an agent replaced, and says who did it', async () => {
    const { browser, tripId, accessToken } = await setup();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari', city: 'Kyoto' },
    });
    const eventId = JSON.parse(created.body.result.content[0].text).eventId;

    await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, city: 'Osaka' },
    });

    const log = await browser.request(`/api/audit/${tripId}?source=mcp`);
    expect(log.body.entries).toHaveLength(2);
    expect(log.body.entries[0].summary).toContain('Changed');
    expect(log.body.entries[0].actor).toBeTruthy();

    const undo = await browser.request(`/api/audit/${tripId}/${log.body.entries[0].id}/undo`, {
      method: 'POST',
    });
    expect(undo.status).toBe(200);

    const after = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });
    expect(JSON.parse(after.body.result.content[0].text).event.city).toBe('Kyoto');
  });

  it('undoes a creation by removing what it made', async () => {
    const { browser, tripId, accessToken } = await setup();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Should not survive' },
    });

    const log = await browser.request(`/api/audit/${tripId}`);
    await browser.request(`/api/audit/${tripId}/${log.body.entries[0].id}/undo`, { method: 'POST' });

    const events = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId },
    });
    expect(events.body.result.content[0].text).not.toContain('Should not survive');
  });

  it('refuses to undo the same action twice', async () => {
    const { browser, tripId, accessToken } = await setup();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Once' },
    });

    const log = await browser.request(`/api/audit/${tripId}`);
    const path = `/api/audit/${tripId}/${log.body.entries[0].id}/undo`;

    expect((await browser.request(path, { method: 'POST' })).status).toBe(200);
    // The second one would delete an already-deleted event, which is harmless
    // here but would not be for an undo that puts a value back.
    expect((await browser.request(path, { method: 'POST' })).status).toBe(409);
  });
});
