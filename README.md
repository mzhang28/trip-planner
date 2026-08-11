# Trip Planner

A trip planner a small group edits together. Every change works offline and merges
when you reconnect, so you can rearrange a day on a plane and have it show up for
everyone else when you land.

## What it does

Create an event with nothing but a name and fill in the rest later: where it is,
when it starts, how long it takes, whether it is booked, links, files, and any
custom field this particular trip needs. Share a trip with a link. See it as a
month of cities, a week with your hotels along the bottom, or a day beside a map.

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
