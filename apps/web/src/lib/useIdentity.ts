import { useEffect, useState } from 'react';

export interface Identity {
  userId: string;
  displayName: string;
}

let pending: Promise<Identity> | null = null;

/**
 * Settles who this browser is, once, before anything else asks the server.
 *
 * The server mints a person and a session for any request that arrives without
 * one. That is what lets someone open a shared link and start editing with no
 * sign-in, but it means two requests sent before a cookie exists each mint their
 * own — and the browser keeps whichever reply landed last. A trip created under
 * one of those identities then belongs to somebody the browser is no longer
 * acting as, and every request about it is refused.
 *
 * One shared promise, awaited by everything: the first caller creates the
 * session and the rest reuse it, so there is only ever one to win.
 */
export function bootstrapIdentity(): Promise<Identity> {
  pending ??= fetch('/api/me').then((res) => {
    if (!res.ok) throw new Error('could not establish an identity');
    return res.json() as Promise<Identity>;
  });

  return pending;
}

export function useIdentity(): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let live = true;
    void bootstrapIdentity()
      .then((resolved) => {
        if (live) setIdentity(resolved);
      })
      .catch(() => {
        // Offline on a cold start. The routes below still render from whatever
        // is in IndexedDB; the next successful request settles the identity.
        if (live) setIdentity({ userId: 'unknown', displayName: 'You' });
      });

    return () => {
      live = false;
    };
  }, []);

  return identity;
}
