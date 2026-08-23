import { createHash } from 'node:crypto';
import type { TripDoc } from '@trip/crdt';
import { trips } from '@trip/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { tripCalendar } from '../calendar/feed';
import { createFeed, listFeeds, recordFetch, resolveFeed, revokeFeed } from '../calendar/feeds';
import type { AppEnv } from '../context';
import { requireMembership } from '../middleware';

const createSchema = z.object({
  label: z.string().max(80).optional(),
  confirmedOnly: z.boolean().default(false),
});

/**
 * How long a client may treat its copy as current.
 *
 * Nothing, because the whole promise of a subscription is that the plan moving
 * reaches it. Answering a poll is cheap — the document is already in memory and
 * the ETag below turns an unchanged trip into an empty reply — so there is
 * nothing to buy by letting a cache in between hold on to yesterday's
 * itinerary.
 */
const CACHE = 'private, no-cache';

/**
 * Says nothing about whether the trip exists.
 *
 * A revoked feed and a made-up token answer the same way, so that guessing at
 * URLs tells the guesser nothing. Plain text rather than JSON: what reads this
 * is a calendar client, and some of them show the body when a subscription
 * stops working.
 */
const NOT_AVAILABLE = 'This calendar is not available. The link may have been revoked.';

/**
 * The calendar itself, fetched by a subscriber's client and nothing else.
 *
 * Outside `/api` for the same reason `/files` is: what polls this holds no
 * cookie and no bearer token, and has no way to acquire either. The token in
 * the path is its whole authority, and it is authority to read one trip.
 */
export function calendarRoutes() {
  const app = new Hono<AppEnv>();

  app.on(['GET', 'HEAD'], '/:token', (c) => {
    const { db, docs } = c.var.services;

    // The suffix is decoration for the clients that judge a URL by its ending,
    // so it is not part of the token.
    const offered = c.req.param('token').replace(/\.ics$/i, '');

    const feed = resolveFeed(db, offered);
    if (!feed) return c.text(NOT_AVAILABLE, 404);

    const trip = db.select({ name: trips.name }).from(trips).where(eq(trips.id, feed.tripId)).get();

    const doc = docs.load(feed.tripId);
    if (!trip || !doc) return c.text(NOT_AVAILABLE, 404);

    recordFetch(db, feed.id);

    const body = tripCalendar(feed.tripId, doc as TripDoc, {
      name: trip.name,
      confirmedOnly: feed.confirmedOnly,
    });

    /*
     * A hash of what was written, so it changes when and only when the calendar
     * does. A client that asks again with this gets an empty answer whenever
     * nothing it can see has moved, which is most of the times it will ask —
     * an edit to a field no calendar shows does not send the trip again.
     */
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;

    if (c.req.header('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, 'cache-control': CACHE },
      });
    }

    const headers = {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': disposition(trip.name),
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': CACHE,
      etag,
    };

    // A client that asked only whether the feed is there gets the headers and
    // no itinerary; writing a body to a HEAD is not something the client reads.
    return new Response(c.req.method === 'HEAD' ? null : body, { headers });
  });

  return app;
}

/**
 * What a browser calls the file if somebody opens the URL directly.
 *
 * `inline`, because a subscription is the point and a download is the accident;
 * and undated, unlike an export, because this address answers with the trip as
 * it stands rather than with a copy taken on a particular day.
 */
function disposition(tripName: string): string {
  const cleaned = Array.from(tripName.replace(/[\p{C}/\\:*?"<>|]/gu, ' ').replace(/\s+/g, '-'))
    .slice(0, 60)
    .join('')
    .replace(/^[-.]+|-+$/g, '');

  const name = `${cleaned || 'trip'}.ics`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');

  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Making a subscription URL, seeing which exist, and ending one.
 *
 * Offered to everyone on the trip rather than only its owner, on the same
 * reasoning as the export: a viewer can already read every event, so a feed
 * that repeats them to their phone withholds nothing. It is also the case worth
 * serving — the person who wants the trip in their own calendar is usually not
 * the person who created it.
 */
export function calendarFeedRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/:tripId/calendar', requireMembership, (c) => {
    const { db } = c.var.services;
    const membership = c.var.membership!;

    return c.json({ feeds: listFeeds(db, membership.tripId), you: membership.userId });
  });

  app.post('/:tripId/calendar', requireMembership, async (c) => {
    const { db } = c.var.services;
    const membership = c.var.membership!;

    const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

    const label = parsed.data.label?.trim();

    const feed = createFeed(
      db,
      { tripId: membership.tripId, userId: membership.userId },
      { label: label || undefined, confirmedOnly: parsed.data.confirmedOnly },
    );

    return c.json(feed, 201);
  });

  app.post('/:tripId/calendar/:feedId/revoke', requireMembership, (c) => {
    const { db } = c.var.services;
    const membership = c.var.membership!;

    revokeFeed(db, membership.tripId, c.req.param('feedId'));

    return c.json({ ok: true });
  });

  return app;
}
