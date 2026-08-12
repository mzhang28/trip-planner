import { createHash, randomBytes } from 'node:crypto';
import { authCredentials, instanceSettings, sessions, users, type TripRole } from '@trip/schema';
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
/*
 * Words for a name nobody has to type.
 *
 * Everyone anonymous was called "Someone", so an owner looking at four people
 * on a trip saw four rows saying the same thing and could not tell whose
 * access to remove. A pair of ordinary words is enough to tell people apart
 * and says nothing about who they are.
 */
const COLOURS = ['Amber', 'Blue', 'Coral', 'Green', 'Indigo', 'Olive', 'Plum', 'Rust'];
const THINGS = ['Ferry', 'Kite', 'Lantern', 'Map', 'Postcard', 'Suitcase', 'Tram', 'Umbrella'];

function anonymousName(): string {
  const colour = COLOURS[Math.floor(Math.random() * COLOURS.length)] ?? 'Blue';
  const thing = THINGS[Math.floor(Math.random() * THINGS.length)] ?? 'kite';

  return `${colour} ${thing.toLowerCase()}`;
}

export function createAnonymousUser(db: Db, displayName = anonymousName()): Identity {
  const now = Date.now();
  const userId = `u_${token(16)}`;

  /*
   * The first person to arrive on an empty database is the admin, and their
   * arrival shuts the door behind them. Whoever put the server up is the one
   * who reaches it first, and nobody after them gets in without being asked.
   */
  const first = db.select({ id: users.id }).from(users).limit(1).get() === undefined;

  db.insert(users)
    .values({
      id: userId,
      displayName,
      avatarColor: pickAvatarColor(),
      adminSince: first ? now : null,
      createdAt: now,
    })
    .run();

  if (first) closeRegistration(db, now);

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

/**
 * The one settings row, made on first read so no migration has to seed it.
 *
 * A database that already has people on it when this row first appears is one
 * that predates the door existing. Its earliest user becomes the admin and it
 * closes, which is where it would have ended up had it always worked this way —
 * otherwise an upgraded server stays open to anyone with nobody able to shut it.
 */
function settings(db: Db) {
  const existing = db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).get();
  if (existing) return existing;

  const earliest = db
    .select({ id: users.id })
    .from(users)
    .orderBy(users.createdAt)
    .limit(1)
    .get();

  const closedAt = earliest ? Date.now() : null;
  if (earliest) db.update(users).set({ adminSince: closedAt }).where(eq(users.id, earliest.id)).run();

  db.insert(instanceSettings).values({ id: 1, registrationClosedAt: closedAt }).run();
  return { id: 1, registrationClosedAt: closedAt };
}

/** Whether somebody arriving with no session may have an account made for them. */
export function registrationIsOpen(db: Db): boolean {
  return settings(db).registrationClosedAt === null;
}

export function closeRegistration(db: Db, at = Date.now()): void {
  settings(db);
  db.update(instanceSettings)
    .set({ registrationClosedAt: at })
    .where(eq(instanceSettings.id, 1))
    .run();
}

export function openRegistration(db: Db): void {
  settings(db);
  db.update(instanceSettings)
    .set({ registrationClosedAt: null })
    .where(eq(instanceSettings.id, 1))
    .run();
}

export function isAdmin(db: Db, userId: string): boolean {
  const row = db.select({ adminSince: users.adminSince }).from(users).where(eq(users.id, userId)).get();
  return row?.adminSince != null;
}
