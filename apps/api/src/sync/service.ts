import { create } from '@bufbuild/protobuf';
import {
  Code,
  ConnectError,
  createContextKey,
  type ConnectRouter,
  type HandlerContext,
} from '@connectrpc/connect';
import { canSyncIncrementally } from '@trip/crdt';
import {
  PushResponseSchema,
  ResyncRequiredSchema,
  SessionOpenedSchema,
  SyncEventSchema,
  SyncMessageSchema,
  SyncService,
  type PushRequest,
  type PushResponse,
  type SubscribeRequest,
  type SyncEvent,
} from '@trip/proto';
import { trips } from '@trip/schema';
import { eq } from 'drizzle-orm';
import type { Services } from '../context';
import type { Identity } from '../identity';
import { lookupMembership } from '../membership';
import type { SyncSessions } from './sessions';

/**
 * Who the caller is, put here by the adapter that hands requests over from
 * Hono.
 *
 * Connect handlers do not run inside Hono's request context, so the person the
 * session cookie resolved to is carried across explicitly rather than read back
 * out of the request a second time.
 */
export const identityContext = createContextKey<Identity | null>(null);

function callerOf(context: HandlerContext): Identity {
  const identity = context.values.get(identityContext);
  if (!identity) throw new ConnectError('no session', Code.Unauthenticated);
  return identity;
}

/**
 * What this person may do with this trip, as things stand right now.
 *
 * Read on every message rather than kept on the session. An owner can change
 * somebody's role or remove them while they are connected, and a check made
 * when they connected would not notice until they next reloaded.
 */
function roleFor(services: Services, tripId: string, userId: string) {
  const membership = lookupMembership(services.db, tripId, userId);

  if (membership === 'not_a_member') {
    throw new ConnectError('not a member of this trip', Code.PermissionDenied);
  }
  if (membership === 'no_such_trip') {
    throw new ConnectError('no such trip', Code.NotFound);
  }

  return membership.role;
}

export function syncService(services: Services, sessions: SyncSessions) {
  return (router: ConnectRouter) =>
    router.service(SyncService, {
      async *subscribe(
        request: SubscribeRequest,
        context: HandlerContext,
      ): AsyncGenerator<SyncEvent> {
        const caller = callerOf(context);
        roleFor(services, request.tripId, caller.userId);

        const trip = services.db
          .select({ sweptAt: trips.tombstonesSweptAt })
          .from(trips)
          .where(eq(trips.id, request.tripId))
          .get();

        if (!trip) throw new ConnectError('no such trip', Code.NotFound);

        /*
         * A client that has not synced since before the sweep may still be
         * holding events whose tombstones have been removed. Merging it would
         * put those events back, so it is sent away for a fresh copy instead of
         * being let into the conversation.
         */
        const admissible = canSyncIncrementally(
          request.lastSyncedAt === undefined ? undefined : Number(request.lastSyncedAt),
          trip.sweptAt ?? undefined,
          request.hasLocalChanges,
        );

        if (!admissible) {
          yield create(SyncEventSchema, {
            event: {
              case: 'resyncRequired',
              value: create(ResyncRequiredSchema, {
                sweptAt: trip.sweptAt === null ? undefined : BigInt(trip.sweptAt),
              }),
            },
          });
          return;
        }

        const session = sessions.open(request.tripId, caller.userId);

        try {
          // First, and before anything is sent: until the client has this it
          // has no way to name the conversation it is answering.
          yield create(SyncEventSchema, {
            event: {
              case: 'opened',
              value: create(SessionOpenedSchema, { sessionId: session.id }),
            },
          });

          for await (const payload of sessions.stream(session, context.signal)) {
            yield create(SyncEventSchema, {
              event: {
                case: 'message',
                value: create(SyncMessageSchema, { payload, syncedAt: BigInt(Date.now()) }),
              },
            });
          }
        } finally {
          sessions.close(session);
        }
      },

      async push(request: PushRequest, context: HandlerContext): Promise<PushResponse> {
        const caller = callerOf(context);

        const session = sessions.sessionOf(request.sessionId, caller.userId);
        const role = roleFor(services, session.tripId, caller.userId);

        sessions.receive(session, role, request.payload);

        return create(PushResponseSchema, { syncedAt: BigInt(Date.now()) });
      },
    });
}
