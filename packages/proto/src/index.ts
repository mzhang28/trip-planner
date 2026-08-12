/**
 * The wire contract between the browser and the API.
 *
 * `proto/` holds the definitions and `src/gen/` holds the TypeScript that
 * `pnpm --filter @trip/proto generate` writes from them, overwriting whatever
 * was there. Both are tracked in git, so a checkout typechecks and runs without
 * anyone having to install buf first.
 */
export {
  PushRequestSchema,
  PushResponseSchema,
  ResyncRequiredSchema,
  SessionOpenedSchema,
  SubscribeRequestSchema,
  SyncEventSchema,
  SyncMessageSchema,
  SyncService,
  type PushRequest,
  type PushResponse,
  type ResyncRequired,
  type SessionOpened,
  type SubscribeRequest,
  type SyncEvent,
  type SyncMessage,
} from './gen/trip/sync/v1/sync_pb.js';
