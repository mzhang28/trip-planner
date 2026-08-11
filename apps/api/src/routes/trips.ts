import { shareLinks, tripMembers, trips, type TripRole } from '@trip/schema';
import { and, desc, eq, isNull, or, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { hashToken, strongerRole, token } from '../identity';
import { requireMembership } from '../middleware';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  homeTimezone: z.string().min(1).default('UTC'),
});

const shareSchema = z.object({
  role: z.enum(['viewer', 'editor']).default('editor'),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export function tripRoutes() {
  const app = new Hono<AppEnv>();

  /** Every trip this person has ever opened, most recently opened first. */
  app.get('/', (c) => {
    const { db } = c.var.services;

    const rows = db
      .select({
        id: trips.id,
        name: trips.name,
        homeTimezone: trips.homeTimezone,
        role: tripMembers.role,
        lastOpenedAt: tripMembers.lastOpenedAt,
      })
      .from(tripMembers)
      .innerJoin(trips, eq(trips.id, tripMembers.tripId))
      .where(eq(tripMembers.userId, c.var.identity.userId))
      .orderBy(desc(tripMembers.lastOpenedAt))
      .all();

    return c.json({ trips: rows });
  });

  app.post('/', async (c) => {
    const { db, docs } = c.var.services;
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

    const { name, homeTimezone } = parsed.data;
    const id = `t_${token(16)}`;
    const now = Date.now();
    const { userId } = c.var.identity;

    db.transaction((tx) => {
      tx.insert(trips).values({ id, name, homeTimezone, createdBy: userId, createdAt: now }).run();
      tx.insert(tripMembers)
        .values({
          tripId: id,
          userId,
          role: 'owner',
          grantedVia: null,
          firstOpenedAt: now,
          lastOpenedAt: now,
        })
        .run();
    });

    docs.create(id, name, homeTimezone);

    return c.json({ id, name, homeTimezone, role: 'owner' satisfies TripRole }, 201);
  });

  app.get('/:tripId', requireMembership, (c) => {
    const { db } = c.var.services;
    const membership = c.var.membership!;

    const trip = db.select().from(trips).where(eq(trips.id, membership.tripId)).get();
    if (!trip) return c.json({ error: 'no_such_trip' }, 404);

    db.update(tripMembers)
      .set({ lastOpenedAt: Date.now() })
      .where(
        and(
          eq(tripMembers.tripId, membership.tripId),
          eq(tripMembers.userId, membership.userId),
        ),
      )
      .run();

    return c.json({
      id: trip.id,
      name: trip.name,
      homeTimezone: trip.homeTimezone,
      role: membership.role,
    });
  });

  /**
   * Mints a link that grants a role on this trip.
   *
   * The token is returned once and stored only as a hash, so it cannot be read
   * back out later — losing it means making another one.
   */
  app.post('/:tripId/share', requireMembership, async (c) => {
    const { db } = c.var.services;
    const membership = c.var.membership!;

    if (membership.role !== 'owner') return c.json({ error: 'owner_only' }, 403);

    const parsed = shareSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

    const raw = token();
    const now = Date.now();

    db.insert(shareLinks)
      .values({
        id: `sl_${token(16)}`,
        tripId: membership.tripId,
        tokenHash: hashToken(raw),
        role: parsed.data.role,
        createdBy: membership.userId,
        createdAt: now,
        expiresAt: parsed.data.expiresInDays
          ? now + parsed.data.expiresInDays * 24 * 60 * 60 * 1000
          : null,
      })
      .run();

    return c.json({ token: raw, role: parsed.data.role }, 201);
  });

  return app;
}

export function shareRoutes() {
  const app = new Hono<AppEnv>();

  /**
   * Turns a link into a membership.
   *
   * Idempotent: following the same link twice does not downgrade someone who
   * already holds a stronger role, which is what would otherwise happen to an
   * owner who clicked their own viewer link.
   */
  app.post('/:token', (c) => {
    const { db } = c.var.services;
    const { userId } = c.var.identity;
    const now = Date.now();

    const link = db
      .select()
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.tokenHash, hashToken(c.req.param('token'))),
          isNull(shareLinks.revokedAt),
          or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now)),
        ),
      )
      .get();

    if (!link) return c.json({ error: 'link_not_usable' }, 404);

    const existing = db
      .select({ role: tripMembers.role })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, link.tripId), eq(tripMembers.userId, userId)))
      .get();

    const role = existing ? strongerRole(existing.role, link.role) : link.role;

    db.insert(tripMembers)
      .values({
        tripId: link.tripId,
        userId,
        role,
        grantedVia: link.id,
        firstOpenedAt: now,
        lastOpenedAt: now,
      })
      .onConflictDoUpdate({
        target: [tripMembers.tripId, tripMembers.userId],
        set: { role, lastOpenedAt: now },
      })
      .run();

    return c.json({ tripId: link.tripId, role });
  });

  return app;
}
