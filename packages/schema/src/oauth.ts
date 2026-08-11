import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { trips, users } from './identity';

/**
 * A client that registered itself, per RFC 7591.
 *
 * MCP clients cannot be pre-registered — nobody knows in advance which agent a
 * person will point at their trip — so registration is open and rate limited
 * rather than restricted to a list.
 */
export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  /** Null for a public client, which uses PKCE instead of a secret. */
  clientSecretHash: text('client_secret_hash'),
  clientName: text('client_name').notNull(),
  /** JSON array. Matched exactly, so an open redirect cannot be constructed. */
  redirectUris: text('redirect_uris').notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().$type<'none' | 'client_secret_post' | 'client_secret_basic'>(),
  createdAt: integer('created_at').notNull(),
});

/**
 * An authorization code, which is single use and lives for a minute.
 *
 * The PKCE challenge is stored rather than the verifier: the client proves it
 * is the same one that started the flow by producing the verifier at the token
 * endpoint, and a server that stored the verifier could not tell the difference.
 */
export const oauthAuthCodes = sqliteTable(
  'oauth_auth_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    clientId: text('client_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    scope: text('scope').notNull(),
    /** RFC 8707. What the token will be usable against. */
    resource: text('resource'),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().$type<'S256'>(),
    /** JSON array of trip ids the person ticked on the consent screen. */
    grantedTripIds: text('granted_trip_ids').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [index('oauth_auth_codes_user').on(table.userId)],
);

export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    type: text('type').notNull().$type<'access' | 'refresh'>(),
    clientId: text('client_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    /** The audience. A token for another server is refused here. */
    resource: text('resource'),
    grantedTripIds: text('granted_trip_ids').notNull(),
    /**
     * Ties a refresh token to the ones it replaced. Presenting a rotated token
     * means it leaked, so the whole family is revoked rather than just that one.
     */
    familyId: text('family_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('oauth_tokens_user').on(table.userId),
    index('oauth_tokens_family').on(table.familyId),
  ],
);

/**
 * Every write, and enough of what it replaced to put it back.
 *
 * The UI filters to MCP by default because those are the changes made without
 * anyone watching, but the log covers the app and the API too — a person
 * wondering what happened to their booking does not care which door it came
 * through.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.id),
    source: text('source').notNull().$type<'mcp' | 'web' | 'api'>(),
    /** Which registered client acted, when it was not a person in the app. */
    clientId: text('client_id'),
    toolName: text('tool_name').notNull(),
    argsJson: text('args_json').notNull(),
    /** The affected fields as they were, which is what undo puts back. */
    beforeJson: text('before_json'),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
    undoneAt: integer('undone_at'),
  },
  (table) => [index('audit_log_trip').on(table.tripId, table.createdAt)],
);
