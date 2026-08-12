import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../lib/api';

/**
 * Turns a share link into access, then gets out of the way.
 *
 * Redeeming creates a membership for whoever is holding the link, which is what
 * puts the trip in their list from then on. Someone who followed a link once
 * finds it again without needing the link a second time.
 */
export function Join() {
  const { token } = useParams<{ token: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;

    void api
      .redeemShareLink(token)
      /*
       * A whole page load rather than a route change. On a closed server this
       * link is what created the account, and the identity settled once when
       * the app started — at which point there was nobody to be.
       */
      .then(({ tripId }) => window.location.replace(`/t/${tripId}`))
      .catch(() => setFailed(true));
  }, [token]);

  return (
    <div className="grid h-dvh place-items-center overflow-hidden bg-page px-6 text-center text-ink">
      {failed ? (
        <div>
          <h1 className="mb-2 text-xl">This link no longer works</h1>
          <p className="text-ink-secondary">
            It may have been revoked or run out. Ask whoever shared it for a new one.
          </p>
        </div>
      ) : (
        <p className="text-ink-secondary">Opening the trip…</p>
      )}
    </div>
  );
}
