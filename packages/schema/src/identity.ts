import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/**
 * A person. One row exists from the first page load, before anyone has signed
 * in to anything.
 *
 * Trip permissions hang off this rather than off a share token, so that adding
 * a real login later is a new row in auth_credentials rather than a rewrite of
 * how access is decided.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  /** Picked at creation so a person is recognisable in a list of initials. */
  avatarColor: text('avatar_color').notNull(),
  /**
   * Set on the first person to arrive on an empty database, and nobody else.
   * Whoever puts the server up is the one who gets to say who else may in.
   */
  adminSince: integer('admin_since'),
  createdAt: integer('created_at').notNull(),
});

/**
 * What is true of this deployment rather than of anyone on it. Exactly one row.
 *
 * Registration shuts behind the first person, so a server left running on the
 * internet is not quietly collecting accounts for anyone who finds it. The
 * admin can open it again for as long as they need it open.
 */
export const instanceSettings = sqliteTable('instance_settings', {
  /** Always 1. There is one deployment, and this is the row describing it. */
  id: integer('id').primaryKey(),
  /** Null while anyone arriving may have an account. */
  registrationClosedAt: integer('registration_closed_at'),
});

/**
 * A way of proving you are a given user.
 *
 * Anonymous visitors get `provider = 'device'` and a hash of a secret their
 * browser generated and keeps in localStorage. Signing in later with Google
 * inserts a second row against the same user_id, so the trips they already
 * opened come with them instead of being stranded on an account they can no
 * longer reach.
 */
export const authCredentials = sqliteTable(
  'auth_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().$type<'device' | 'google' | 'github'>(),
    /** The device id, or the provider's subject claim. */
    providerAccountId: text('provider_account_id').notNull(),
    /** Only set for `device`, where this server issued the secret. */
    secretHash: text('secret_hash'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    unique('auth_credentials_provider_account').on(table.provider, table.providerAccountId),
    index('auth_credentials_user').on(table.userId),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** The hash of the cookie value, never the value itself. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('sessions_user').on(table.userId)],
);

export const trips = sqliteTable(
  'trips',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    homeTimezone: text('home_timezone').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    /**
     * When tombstones were last removed. A peer whose last sync predates this
     * cannot merge safely and has to take a fresh copy.
     */
    tombstonesSweptAt: integer('tombstones_swept_at'),
    /**
     * Set when a trip is put away rather than deleted. It stays in the list
     * behind a filter, so a finished trip stops crowding the ones being
     * planned without anybody having to destroy it to tidy up.
     */
    archivedAt: integer('archived_at'),
  },
  (table) => [index('trips_created_by').on(table.createdBy)],
);

export type TripRole = 'viewer' | 'editor' | 'owner';

/**
 * A link that grants a role on a trip.
 *
 * Only the hash is stored, so a leaked database does not hand out working
 * links. Redeeming one creates a membership; from then on permission is decided
 * by the membership, and revoking the link does not evict people who already
 * used it unless the membership is removed too.
 */
export const shareLinks = sqliteTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role').notNull().$type<TripRole>(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [index('share_links_trip').on(table.tripId)],
);

/**
 * Who may do what to a trip.
 *
 * Every permission check reads this table and never a token. That indirection
 * is the point: a share link is one way to acquire a membership and a future
 * login is another, and nothing downstream has to know which was used.
 *
 * It also answers "which trips have I opened", which is what puts a trip back
 * in someone's list after they followed a link once.
 */
export const tripMembers = sqliteTable(
  'trip_members',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<TripRole>(),
    /** The share link it came from, or null if they created the trip. */
    grantedVia: text('granted_via').references(() => shareLinks.id, { onDelete: 'set null' }),
    firstOpenedAt: integer('first_opened_at').notNull(),
    lastOpenedAt: integer('last_opened_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.userId] }),
    index('trip_members_user').on(table.userId),
  ],
);
