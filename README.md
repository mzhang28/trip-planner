# Trip Planner

A trip planner a small group edits together. Every change works offline and merges
when you reconnect, so you can rearrange a day on a plane and have it show up for
everyone else when you land.

## What it does

Create an event with nothing but a name and fill in the rest later: where it is,
when it starts, how long it takes, whether it is booked, links, files, and any
custom field this particular trip needs. Share a trip with a link. See it as a
month of cities, a week with your hotels along the bottom, or a day beside a map.

Take a whole trip away as a zip, attachments included, and import it back as a new
trip here or on another server. The archive is a plain JSON document beside the
files it names, so it can be read without this application.

## Stack

The client holds a real replica of the trip rather than a cache of server
responses. Automerge gives the merge semantics, SQLite stores the documents and a
queryable projection of them, and the server relays changes rather than deciding
which one wins.

| Piece    | Choice                                        |
| -------- | --------------------------------------------- |
| Frontend | React 19, Vite, Tailwind v4, installable PWA   |
| Data     | Automerge CRDT, persisted to IndexedDB locally |
| Backend  | Hono, Drizzle, SQLite                          |
| Maps     | Leaflet with OpenStreetMap tiles               |
| Weather  | Open-Meteo                                     |
| Agents   | Remote MCP server over HTTP with OAuth         |
| Tests    | Vitest for logic, Playwright for behaviour     |

## Layout

```
packages/crdt      the trip document type, mutations, and search text
packages/schema    Drizzle tables and migrations
packages/ui        design tokens, primitives, and their stories
apps/api           Hono server: sync, blobs, weather, OAuth, MCP
apps/web           the PWA
```

## Connecting an agent

The MCP server is at `/mcp` and speaks OAuth. An agent needs credentials before
it can ask for anything, and those are made on the **Agents** page in the app.
Give it a name and the redirect address from its own documentation, say whether
it runs on a server, and it hands back a client id and, for a hosted agent, a
secret shown that once. Paste both into the agent.

The agent then does the rest itself. It finds the metadata at
`/.well-known/oauth-protected-resource`, opens the consent screen at `/connect`,
and there you pick which trips it may see and whether it may write.

There is no dynamic client registration. Nothing hands out credentials to a
caller that has not signed in, which is why the metadata advertises no
`registration_endpoint` — a client that tried to register itself would only
reach a 401.

The URL an agent connects to has to be the one `PUBLIC_URL` names, because an
access token is bound to that origin and refused anywhere else. Under `pnpm dev`
the app is on port 5173, so run the API with `PUBLIC_URL=http://localhost:5173`.
For anything reachable from the internet it has to be the public HTTPS origin.

The grant is authorization code with PKCE, and nothing else: there is no implicit
grant and no password grant, `S256` is the only challenge method accepted, and a
code is single use. Redirect addresses must be HTTPS unless they point back at
the machine the browser is on. Refresh tokens rotate, and presenting a rotated
one revokes the whole family, on the reasoning that the legitimate holder already
has a newer one. An agent that was given a secret has to present it; one without
is held to PKCE instead. Removing an agent revokes its live tokens, so it stops
working at once rather than when they expire.

Attachments come back with the events they are on, and `list_files` gives the
whole trip's. Each carries a signed link at `/files/<hash>` that an agent can
fetch on its own, since it holds no session and no bearer token to spend. A link
covers one file, lasts a day, and is refused if anything about it is altered.

Every change an agent makes is recorded with who authorised it and through which
client, and the ones that replaced a value can be put back from the trip's audit
list.

## Who may join

The first person to open a new server becomes its admin, and registration shuts
behind them. Anyone arriving after that is told the server is not taking new
people rather than being given an account, which is what a public deployment
needs — the app mints a person for any browser that turns up, and on the open
internet that is everybody.

A share link is the exception, and the ordinary way to bring someone in:
following a live one creates an account for whoever holds it, open or not. The
admin can also open registration from **Settings**, which lets people start on
their own without a link, and shut it again afterwards.

Upgrading an existing server settles the same way the first time it is asked:
its earliest user becomes the admin and registration closes, so an instance that
predates any of this does not sit open with nobody able to close it.

## Attachments

Files go to `data/blobs` by default. To use object storage instead, set
`BLOB_STORE=s3` along with `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and
`S3_SECRET_ACCESS_KEY`. `S3_ENDPOINT` points it at R2, MinIO, or B2; leave it
unset for AWS.

## Running it

```sh
pnpm install
pnpm dev            # api and web together
pnpm storybook      # the design system on its own
pnpm test           # Vitest
pnpm test:e2e       # Playwright
```

Nothing external is needed to run the app. Attachments go to `data/blobs` and the
database to `data/trip-planner.db` unless configured otherwise.

### With Docker

```sh
cp .env.example .env      # set PUBLIC_URL if it is not localhost:8787
docker compose up -d --build
```

One container on port 8787, serving the app and the API together. `WEB_DIST`
points the server at the built client, and it hands those files back for any path
it does not answer itself — so both are one origin, which is what an agent's
access token is bound to, and `PUBLIC_URL` has to be the URL people actually
open. In dev nothing changes: `WEB_DIST` is unset, Vite serves the client, and it
proxies `/api`, `/oauth`, `/mcp` and `/.well-known` back to the API.

The database and the blob store share one volume, `trip-data`, mounted where both
already point. Anything in `.env` reaches the server, so `BLOB_STORE=s3` and its
credentials belong there; the database stays in the volume either way.

The same thing runs without Docker, after `pnpm build`:

```sh
WEB_DIST=apps/web/dist pnpm --filter @trip/api start
```

### Ports

Every `pnpm test:e2e` invocation starts the API and web preview on OS-assigned
ports. The harness discovers both ports from their stdout, builds into a unique
temporary directory, and uses a fresh SQLite database and blob directory. Test
runs can therefore run beside `pnpm dev` and beside each other.

Routine server request logs are suppressed during the browser suite. Run with
`E2E_SERVER_LOGS=1 pnpm test:e2e` when those logs are needed for debugging.

| Port | What                                            |
| ---- | ----------------------------------------------- |
| 5173 | web, `pnpm dev`                                 |
| 8787 | api, `pnpm dev`                                 |
| 6006 | Storybook                                       |

All three dev servers listen on `0.0.0.0` and accept any hostname, so they are
reachable from another machine on the network.
