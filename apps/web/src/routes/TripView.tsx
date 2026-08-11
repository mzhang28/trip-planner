import {
  addEvent,
  deleteEvent,
  updateEvent,
  type BookingStatus,
  type TripDoc,
  type TripEvent,
} from '@trip/crdt';
import { Button, TextField, ThemeToggle } from '@trip/ui';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type TripSummary } from '../lib/api';
import { dayKey, formatDayHeading } from '../lib/time';
import { EventRow } from '../trip/EventRow';
import { SyncBadge } from '../trip/SyncBadge';
import { useEvents, useTripState, useTripStore } from '../trip/useTrip';

const UNSCHEDULED = 'unscheduled';

function groupByDay(events: TripEvent[], homeTimezone: string) {
  const days = new Map<string, TripEvent[]>();

  for (const event of events) {
    const key =
      event.startsAt === undefined
        ? UNSCHEDULED
        : dayKey(event.startsAt, event.timezone ?? homeTimezone);

    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }

  return [...days.entries()];
}

export function TripView() {
  const { tripId } = useParams<{ tripId: string }>();
  const store = useTripStore(tripId);
  const state = useTripState(store);
  const events = useEvents(state);

  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [draft, setDraft] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId) return;
    void api.getTrip(tripId).then(setTrip).catch(() => setTrip(null));
  }, [tripId]);

  const homeTimezone = trip?.homeTimezone ?? (state?.doc as TripDoc | undefined)?.meta?.homeTimezone ?? 'UTC';
  const readOnly = trip?.role === 'viewer';
  const days = useMemo(() => groupByDay(events, homeTimezone), [events, homeTimezone]);

  function create() {
    const name = draft.trim();
    if (!name || !store) return;

    const id = `e_${crypto.randomUUID()}`;
    store.change((doc) => addEvent(doc, { id, name }, { userId: 'me' }));
    setDraft('');
  }

  async function share() {
    if (!tripId) return;
    const { token } = await api.createShareLink(tripId, 'editor');
    setShareUrl(`${location.origin}/join/${token}`);
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="text-xs text-ink-muted underline-offset-2 hover:underline">
            All trips
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg">{trip?.name ?? 'Trip'}</h1>
          <SyncBadge state={state} />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {!readOnly && (
          <div className="mb-6 flex items-end gap-2">
            <TextField
              label="New event"
              labelHidden
              className="flex-1"
              placeholder="Add something — a name is enough"
              value={draft}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />
            <Button variant="primary" onPress={create} isDisabled={draft.trim() === ''}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        )}

        {events.length === 0 && (
          <p className="py-10 text-center text-ink-secondary">
            Nothing here yet. Add the first thing you know about — where you are staying, or the
            flight out.
          </p>
        )}

        {days.map(([key, dayEvents]) => (
          <section key={key} className="mb-8">
            <h2 className="mb-2 text-sm text-ink-muted">
              {key === UNSCHEDULED
                ? 'No time yet'
                : formatDayHeading(dayEvents[0]!.startsAt!, dayEvents[0]!.timezone ?? homeTimezone)}
            </h2>
            <div className="flex flex-col gap-2">
              {dayEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  homeTimezone={homeTimezone}
                  readOnly={readOnly}
                  onRename={(name) =>
                    store?.change((doc) => updateEvent(doc, event.id, { name }, { userId: 'me' }))
                  }
                  onSetTime={(startsAt) =>
                    store?.change((doc) =>
                      updateEvent(
                        doc,
                        event.id,
                        { startsAt, timezone: event.timezone ?? homeTimezone },
                        { userId: 'me' },
                      ),
                    )
                  }
                  onSetStatus={(status: BookingStatus) =>
                    store?.change((doc) =>
                      updateEvent(
                        doc,
                        event.id,
                        { booking: { ...event.booking, status } },
                        { userId: 'me' },
                      ),
                    )
                  }
                  onDelete={() =>
                    store?.change((doc) => deleteEvent(doc, event.id, { userId: 'me' }))
                  }
                />
              ))}
            </div>
          </section>
        ))}

        {trip?.role === 'owner' && (
          <section className="mt-10 border-t border-line pt-6">
            <Button onPress={share}>Share trip</Button>
            {shareUrl && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">
                  Anyone with this link can edit the trip. It is shown once.
                </p>
                <code className="block rounded-md bg-sunken px-2 py-1.5 text-xs break-all">
                  {shareUrl}
                </code>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
