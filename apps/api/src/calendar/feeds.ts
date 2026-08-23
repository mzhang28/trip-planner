import { calendarFeeds, users } from '@trip/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config';
import type { Db } from '../db';
import { hashToken, token } from '../identity';

/**
 * The subscription URLs a trip has handed out, and what to do with them.
 *
 * A feed is a bearer credential written into a URL, because that is the only
 * thing a calendar client can be given: it has no way to sign in, and nowhere
 * to put a header. So the token is long, it is stored only as a hash, and it
 * can be revoked one feed at a time — someone who put the trip on a phone they
 * have since lost should be able to end that subscription without ending
 * everybody else's.
 */

export interface NewFeed {
  id: string;
  /** The one time the token exists outside the subscriber's calendar client. */
  url: string;
  /** The same URL, in the scheme that makes a client offer to subscribe. */
  webcalUrl: string;
  label: string | null;
  confirmedOnly: boolean;
}

/** A feed as the list shows it, which cannot include the token. */
export interface FeedSummary {
  id: string;
  label: string | null;
  confirmedOnly: boolean;
  createdAt: number;
  createdBy: string;
  /** Whoever made it, by the name they are known by everywhere else. */
  createdByName: string;
  lastFetchedAt: number | null;
  fetchCount: number;
}

export interface ResolvedFeed {
  id: string;
  tripId: string;
  confirmedOnly: boolean;
}

/**
 * The address a client polls.
 *
 * `.ics` on the end is not needed to find the route and is there for the
 * clients that decide what a URL is by looking at it rather than at the content
 * type it answers with.
 */
export function feedUrl(raw: string): string {
  return `${config.PUBLIC_URL}/calendar/${raw}.ics`;
}

/**
 * The same address as `webcal:`, which is what makes a subscription one tap.
 *
 * A calendar client registers itself for the scheme, so following one of these
 * opens the client with the URL filled in instead of downloading a file the
 * browser then has nothing to do with. It is the same request over HTTP once
 * the client makes it.
 */
export function webcalUrl(raw: string): string {
  return feedUrl(raw).replace(/^https?:/, 'webcal:');
}

export function createFeed(
  db: Db,
  trip: { tripId: string; userId: string },
  details: { label?: string; confirmedOnly: boolean },
): NewFeed {
  const raw = token();
  const id = `cf_${token(16)}`;

  db.insert(calendarFeeds)
    .values({
      id,
      tripId: trip.tripId,
      tokenHash: hashToken(raw),
      label: details.label ?? null,
      confirmedOnly: details.confirmedOnly,
      createdBy: trip.userId,
      createdAt: Date.now(),
    })
    .run();

  return {
    id,
    url: feedUrl(raw),
    webcalUrl: webcalUrl(raw),
    label: details.label ?? null,
    confirmedOnly: details.confirmedOnly,
  };
}

/** The feeds still working for this trip, most recently made first. */
export function listFeeds(db: Db, tripId: string): FeedSummary[] {
  return db
    .select({
      id: calendarFeeds.id,
      label: calendarFeeds.label,
      confirmedOnly: calendarFeeds.confirmedOnly,
      createdAt: calendarFeeds.createdAt,
      createdBy: calendarFeeds.createdBy,
      createdByName: users.displayName,
      lastFetchedAt: calendarFeeds.lastFetchedAt,
      fetchCount: calendarFeeds.fetchCount,
    })
    .from(calendarFeeds)
    .innerJoin(users, eq(users.id, calendarFeeds.createdBy))
    .where(and(eq(calendarFeeds.tripId, tripId), isNull(calendarFeeds.revokedAt)))
    .orderBy(desc(calendarFeeds.createdAt))
    .all();
}

/**
 * Stops a feed answering.
 *
 * Scoped to the trip as well as the id, so holding a feed id from one trip is
 * not a way to revoke a feed on another.
 */
export function revokeFeed(db: Db, tripId: string, feedId: string): void {
  db.update(calendarFeeds)
    .set({ revokedAt: Date.now() })
    .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.tripId, tripId)))
    .run();
}

/** The trip a token is for, or null when nothing live matches it. */
export function resolveFeed(db: Db, raw: string): ResolvedFeed | null {
  const found = db
    .select({
      id: calendarFeeds.id,
      tripId: calendarFeeds.tripId,
      confirmedOnly: calendarFeeds.confirmedOnly,
    })
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.tokenHash, hashToken(raw)), isNull(calendarFeeds.revokedAt)))
    .get();

  return found ?? null;
}

/**
 * Records that something asked for the feed.
 *
 * The only evidence a subscription exists. Setting a feed up happens in another
 * app and reports nothing back, so without this there is no way to tell a URL
 * that a phone is polling every hour from one that was pasted into a chat and
 * never used.
 */
export function recordFetch(db: Db, feedId: string): void {
  db.update(calendarFeeds)
    .set({
      lastFetchedAt: Date.now(),
      fetchCount: sql`${calendarFeeds.fetchCount} + 1`,
    })
    .where(eq(calendarFeeds.id, feedId))
    .run();
}
