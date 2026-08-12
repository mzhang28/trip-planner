import { Button, Card, TextField, ThemeToggle } from '@trip/ui';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, deviceTimezone, type TripSummary } from '../lib/api';

/*
 * Read in the trip's own zone, like every other date in the app. A trip
 * planned in Tokyo that starts at midnight there is 15:00 the day before in
 * UTC, and a card that says so names the wrong day.
 */
function day(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(at);
}

/** The span a trip covers, or that nothing has been dated yet. */
function when(trip: TripSummary): string {
  const zone = trip.homeTimezone;
  if (!trip.startsAt) return 'No dates yet';
  if (!trip.endsAt || trip.endsAt === trip.startsAt) return day(trip.startsAt, zone);

  return `${day(trip.startsAt, zone)} – ${day(trip.endsAt, zone)}`;
}

function whatIsNext(trip: TripSummary): string {
  if (trip.nextAt) return `Next on ${day(trip.nextAt, trip.homeTimezone)}`;
  if (trip.startsAt) return 'Nothing left to come';

  return 'Nothing planned yet';
}

export function TripList() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);

  /*
   * A list that could not be fetched used to become an empty list, which reads
   * as "you have no trips" -- and somebody who believes that starts again from
   * nothing while their trips sit on the server.
   */
  const [unreachable, setUnreachable] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    setUnreachable(false);
    void api
      .listTrips()
      .then((res) => {
        setTrips(res.trips);
      })
      .catch(() => setUnreachable(true));
  }, []);

  useEffect(load, [load]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const trip = await api.createTrip(trimmed, deviceTimezone());
    void navigate(`/t/${trip.id}`);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <h1 className="text-lg">Trips</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end gap-2">
          <TextField
            label="New trip"
            labelHidden
            className="flex-1"
            placeholder="Where are you going?"
            value={name}
            onChange={setName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
          <Button variant="primary" onPress={() => void create()} isDisabled={name.trim() === ''}>
            <Plus className="size-4" />
            New trip
          </Button>
        </div>

        {unreachable ? (
          <div
            data-testid="trips-unreachable"
            className="flex flex-col items-center gap-3 py-10 text-center"
          >
            <p className="text-ink-secondary">
              Your trips could not be loaded. The server did not answer, so this is not the whole
              list.
            </p>
            <Button onPress={load}>Try again</Button>
          </div>
        ) : (
          trips?.length === 0 && (
            <p className="py-10 text-center text-ink-secondary">
              No trips yet. Name one above — you can work out the dates later.
            </p>
          )
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {trips?.map((trip) => (
            <Card key={trip.id}>
              <Link
                to={`/t/${trip.id}`}
                className="flex flex-col gap-1 px-3 py-3 hover:bg-sunken"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{trip.name}</span>
                  <span className="shrink-0 text-2xs text-ink-muted">{trip.role}</span>
                </span>

                {/*
                  When, where, and what is next. A card showing only a name and
                  a role made "Japan" and "Japan again" the same card twice.
                */}
                <span className="truncate text-2xs text-ink-secondary">
                  {when(trip)}
                  {trip.destination && ` · ${trip.destination}`}
                  {trip.moreCities ? ` +${trip.moreCities}` : ''}
                </span>
                <span className="truncate text-2xs text-ink-muted">{whatIsNext(trip)}</span>
              </Link>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
