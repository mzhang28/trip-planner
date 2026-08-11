import { createHash, randomBytes } from 'node:crypto';
import { authCredentials, sessions, users, type TripRole } from '@trip/schema';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from './db';

export const SESSION_COOKIE = 'trip_session';
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

/** The strongest role wins when someone holds more than one grant on a trip. */
const ROLE_RANK: Record<TripRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function strongerRole(a: TripRole, b: TripRole): TripRole {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export function canEdit(role: TripRole): boolean {
  return role === 'editor' || role === 'owner';
}

export function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Session ids and share tokens are stored hashed.
 *
 * SHA-256 without a salt is right here and would be wrong for a password: these
 * are 256-bit random strings, so there is no guessing to slow down, and the only
 * thing being defended against is a leaked database handing out working
 * credentials.
 */
export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const AVATAR_COLORS = [
  '#136f5b',
  '#b06e12',
  '#3b4cca',
  '#b83122',
  '#6c7787',
  '#0e5747',
  '#2f3e9e',
] as const;

function pickAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

export interface Identity {
  userId: string;
  displayName: string;
}

/**
 * Creates a person and a session for a browser that has never been here.
 *
 * They are a real user row from this moment, not a placeholder to be upgraded.
 * Signing in later attaches a second credential to this same id, so the trips
 * they open before signing in are still theirs afterwards.
 */
export function createAnonymousUser(db: Db, displayName = 'Someone'): Identity {
  const now = Date.now();
  const userId = `u_${token(16)}`;

  db.insert(users)
    .values({ id: userId, displayName, avatarColor: pickAvatarColor(), createdAt: now })
    .run();

  const deviceSecret = token();
  db.insert(authCredentials)
    .values({
      id: `ac_${token(16)}`,
      userId,
      provider: 'device',
      providerAccountId: `dev_${token(16)}`,
      secretHash: hashToken(deviceSecret),
      createdAt: now,
    })
    .run();

  return { userId, displayName };
}

/** Returns the raw cookie value; only its hash is stored. */
export function createSession(db: Db, userId: string): string {
  const raw = token();
  const now = Date.now();

  db.insert(sessions)
    .values({
      id: hashToken(raw),
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    })
    .run();

  return raw;
}

export function resolveSession(db: Db, raw: string | undefined): Identity | null {
  if (!raw) return null;

  const row = db
    .select({ userId: users.id, displayName: users.displayName })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(raw)), gt(sessions.expiresAt, Date.now())))
    .get();

  return row ?? null;
}

export function renameUser(db: Db, userId: string, displayName: string): void {
  db.update(users).set({ displayName }).where(eq(users.id, userId)).run();
}
