import { tripMembers } from '@trip/schema';
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { config } from './config';
import type { AppEnv, Services } from './context';
import { createAnonymousUser, createSession, resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from './identity';

export function withServices(services: Services) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('services', services);
    await next();
  });
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

  if (!row) return c.json({ error: 'not_a_member' }, 403);

  c.set('membership', { tripId, userId, role: row.role });
  await next();
});
