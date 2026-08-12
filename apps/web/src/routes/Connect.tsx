import { Button, Card, ThemeToggle, cn } from '@trip/ui';
import { Bot, Check, Eye, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, api, type AuthorizationRequest } from '../lib/api';

/**
 * Why a request can be refused before anyone is asked about it.
 *
 * These describe a client that is asking for something impossible, so there is
 * nothing to consent to and no safe way back: an unverified redirect URI is the
 * open redirect the check exists to stop, so the person is told here instead.
 */
const REFUSALS: Record<string, string> = {
  invalid_client: 'This app is not registered with your trips.',
  invalid_redirect_uri: 'It asked to be sent somewhere it never registered.',
  invalid_scope: 'It asked for a permission that does not exist.',
  unsupported_response_type: 'It asked for a sign-in this server does not do.',
  invalid_request: 'The request was missing something it needs.',
};

export function Connect() {
  const [params] = useSearchParams();
  const [ask, setAsk] = useState<AuthorizationRequest | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [mayWrite, setMayWrite] = useState(true);
  const [deciding, setDeciding] = useState(false);

  const query = params.toString();
  const redirectUri = params.get('redirect_uri') ?? '';
  const clientId = params.get('client_id') ?? '';
  const state = params.get('state') ?? undefined;

  useEffect(() => {
    void api
      .readAuthorizationRequest(query)
      .then(setAsk)
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : 'invalid_request';
        setRefusal(REFUSALS[code] ?? 'The request could not be read.');
      });
  }, [query]);

  const writeWasAsked = useMemo(() => ask?.scope.includes('trips:write') ?? false, [ask]);

  async function decide(approve: boolean) {
    if (!ask) return;
    setDeciding(true);

    try {
      const { redirect_to } = approve
        ? await api.approveAuthorization({
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
            scope: writeWasAsked && mayWrite ? 'trips:read trips:write' : 'trips:read',
            resource: ask.resource,
            code_challenge: params.get('code_challenge') ?? '',
            trip_ids: chosen,
          })
        : await api.denyAuthorization({
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
          });

      // Replace rather than assign: the client's callback is the end of this
      // journey, and Back should not land on a consent screen whose code has
      // already been spent.
      window.location.replace(redirect_to);
    } catch {
      setDeciding(false);
      setRefusal('That could not be sent back to the app. Try connecting again.');
    }
  }

  if (refusal) {
    return (
      <Shell>
        <h1 className="mb-2 text-xl text-ink">This connection was refused</h1>
        <p className="text-sm text-ink-secondary">{refusal}</p>
      </Shell>
    );
  }

  if (!ask) {
    return (
      <Shell>
        <p className="text-sm text-ink-secondary" aria-busy="true">
          Reading the request…
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-ink-secondary">
          <Bot aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg text-ink">
            {ask.client.name} wants to {writeWasAsked ? 'read and change' : 'read'} your trips
          </h1>
          <p className="truncate text-xs text-ink-muted">
            It will be sent back to {ask.client.redirectOrigin}
          </p>
        </div>
      </div>

      {ask.trips.length === 0 ? (
        <p className="mb-5 text-sm text-ink-secondary">
          You have no trips yet, so there is nothing to share. Make one first, then connect the app
          again.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink">Trips it may see</h2>
            <Button
              size="sm"
              variant="ghost"
              onPress={() =>
                setChosen(chosen.length === ask.trips.length ? [] : ask.trips.map((t) => t.id))
              }
            >
              {chosen.length === ask.trips.length ? 'Clear' : 'Select all'}
            </Button>
          </div>

          <ul className="mb-5 flex flex-col gap-1" data-testid="consent-trips">
            {ask.trips.map((trip) => (
              <li key={trip.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2',
                    'hover:bg-sunken',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={chosen.includes(trip.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, trip.id]
                          : current.filter((id) => id !== trip.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{trip.name}</span>
                  <span className="shrink-0 text-2xs text-ink-muted">{trip.role}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {writeWasAsked && (
        <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-md border border-line p-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={mayWrite}
            onChange={(event) => setMayWrite(event.target.checked)}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm text-ink">
              <Pencil aria-hidden="true" className="size-3.5" />
              Let it make changes
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              It can add, edit and delete events on the trips above. Every change is recorded in the
              trip&rsquo;s history, and the ones that replaced something can be put back.
            </span>
          </span>
        </label>
      )}

      {!writeWasAsked && (
        <p className="mb-5 flex items-center gap-1.5 text-xs text-ink-muted">
          <Eye aria-hidden="true" className="size-3.5" />
          It asked to read only, so it cannot change anything.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">Approving as {ask.you.displayName}</p>
        <div className="flex gap-2">
          <Button variant="secondary" isDisabled={deciding} onPress={() => void decide(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isDisabled={deciding || chosen.length === 0}
            onPress={() => void decide(true)}
          >
            <Check aria-hidden="true" className="size-4" />
            Allow
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-3 flex justify-end">
          <ThemeToggle />
        </div>
        <Card className="p-5 sm:p-6">{children}</Card>
      </div>
    </div>
  );
}
