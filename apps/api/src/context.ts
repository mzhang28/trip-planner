import type { TripRole } from '@trip/schema';
import type { Db } from './db';
import type { DocStore } from './docStore';
import type { Identity } from './identity';

export interface Services {
  db: Db;
  docs: DocStore;
}

export interface Membership {
  tripId: string;
  userId: string;
  role: TripRole;
}

export interface AppEnv {
  Variables: {
    services: Services;
    identity: Identity;
    /** Set by requireMembership for routes scoped to one trip. */
    membership?: Membership;
  };
}
