import { shareLinks, tripMembers, trips } from '@trip/schema';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { config } from './config';
import type { AppEnv, Services } from './context';
import type { Db } from './db';
import {
  createAnonymousUser,
  createSession,
  hashToken,
  registrationIsOpen,
  resolveSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from './identity';

export function withServices(services: Services) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('services', services);
    await next();
  });
}

/**
 * Whether this request is somebody redeeming a share link that still works.
 *
 * A link is an invitation, and an invitation is the one thing that gets a
 * person an account on a closed server. It is checked here rather than left to
 * the route, because by the time the route runs the decision to create a person
 * has already been made.
 */
function holdsAnInvitation(c: { req: { method: string; path: string } }, db: Db): boolean {
  if (c.req.method !== 'POST') return false;

  const offered = /^\/api\/share\/([^/]+)$/.exec(c.req.path)?.[1];
  if (!offered) return false;

  const now = Date.now();
  const link = db
    .select({ id: shareLinks.id })
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.tokenHash, hashToken(offered)),
        isNull(shareLinks.revokedAt),
        or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now)),
      ),
    )
    .get();

  return link !== undefined;
}

/**
 * Makes sure there is somebody to attribute this request to.
 *
 * A visitor with no session gets a person created for them rather than being
 * sent to a sign-in page. Opening a shared link should show the trip, and the
 * person who opened it should still have it in their list tomorrow; both need
 * an identity, and neither needs an account.
 */
export const withIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const { db } = c.var.services;
  const existing = resolveSession(db, getCookie(c, SESSION_COOKIE));

  if (existing) {
    c.set('identity', existing);
    await next();
    return;
  }

  if (!registrationIsOpen(db) && !holdsAnInvitation(c, db)) {
    return c.json({ error: 'registration_closed' }, 401);
  }

  const identity = createAnonymousUser(db);
  const raw = createSession(db, identity.userId);

  setCookie(c, SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.isProduction,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  c.set('identity', identity);
  await next();
});

/**
 * Insists the request arrived with a session already, rather than being given
 * one on the way in.
 *
 * `withIdentity` above mints a person for anyone who turns up without a cookie,
 * which is right for opening a shared link and wrong for anything that hands
 * out credentials: a bare POST from a script would otherwise create a user and
 * then be treated as that user. What this asks is that a browser has been here
 * before, which is what "somebody is signed in" amounts to in an app with no
 * sign-in.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const { db } = c.var.services;

  if (!resolveSession(db, getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: 'not_signed_in' }, 401);
  }

  await next();
});

/**
 * Resolves what this person may do with this trip.
 *
 * Reads the membership table and never a share token. A token is one way to
 * acquire a membership, and a future sign-in will be another; deciding access
 * from the membership means nothing downstream has to know which was used.
 */
export const requireMembership = createMiddleware<AppEnv>(async (c, next) => {
  const { db } = c.var.services;
  const tripId = c.req.param('tripId');
  const { userId } = c.var.identity;

  if (!tripId) return c.json({ error: 'no_trip' }, 400);

  const row = db
    .select({ role: tripMembers.role })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
    .get();

  if (!row) {
    /*
     * A trip that is not there is worth saying, and it is not a leak: a trip id
     * is sixteen random bytes, so anyone asking about one either had it or is
     * not going to find it by asking. Answering "not yours" for an address that
     * names nothing sent people looking for access they never needed.
     */
    const exists = db.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).get();
    return exists
      ? c.json({ error: 'not_a_member' }, 403)
      : c.json({ error: 'no_such_trip' }, 404);
  }

  c.set('membership', { tripId, userId, role: row.role });
  await next();
});
