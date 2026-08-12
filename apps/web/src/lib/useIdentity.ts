import { useEffect, useState } from 'react';

export interface Identity {
  userId: string;
  displayName: string;
  /** The first person to arrive, who decides whether anyone else may. */
  admin: boolean;
  registrationOpen: boolean;
}

/** Thrown when the server has an owner already and is not taking anyone else. */
export class RegistrationClosed extends Error {}

export type IdentityState =
  | { status: 'loading' }
  | { status: 'ready'; identity: Identity }
  | { status: 'closed' };

let pending: Promise<Identity> | null = null;

/**
 * Settles who this browser is, once, before anything else asks the server.
 *
 * The server mints a person and a session for any request that arrives without
 * one, as long as registration is open. That is what lets someone open a shared
 * link and start editing with no sign-in, but it means two requests sent before
 * a cookie exists each mint their own — and the browser keeps whichever reply
 * landed last. A trip created under one of those identities then belongs to
 * somebody the browser is no longer acting as, and every request about it is
 * refused.
 *
 * One shared promise, awaited by everything: the first caller creates the
 * session and the rest reuse it, so there is only ever one to win.
 */
export function bootstrapIdentity(): Promise<Identity> {
  pending ??= fetch('/api/me').then((res) => {
    if (res.status === 401) throw new RegistrationClosed();
    if (!res.ok) throw new Error('could not establish an identity');
    return res.json() as Promise<Identity>;
  });

  return pending;
}

export function useIdentity(): IdentityState {
  const [state, setState] = useState<IdentityState>({ status: 'loading' });

  useEffect(() => {
    let live = true;

    void bootstrapIdentity()
      .then((identity) => {
        if (live) setState({ status: 'ready', identity });
      })
      .catch((error: unknown) => {
        if (!live) return;

        if (error instanceof RegistrationClosed) {
          setState({ status: 'closed' });
          return;
        }

        // Offline on a cold start. The routes below still render from whatever
        // is in IndexedDB; the next successful request settles the identity.
        setState({
          status: 'ready',
          identity: {
            userId: 'unknown',
            displayName: 'You',
            admin: false,
            registrationOpen: false,
          },
        });
      });

    return () => {
      live = false;
    };
  }, []);

  return state;
}
