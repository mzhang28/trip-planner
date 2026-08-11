import { Button, Card, TextField, ThemeToggle } from '@trip/ui';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, deviceTimezone, type TripSummary } from '../lib/api';

export function TripList() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    void api
      .listTrips()
      .then((res) => setTrips(res.trips))
      .catch(() => setTrips([]));
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const trip = await api.createTrip(trimmed, deviceTimezone());
    void navigate(`/t/${trip.id}`);
  }

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <h1 className="text-lg">Trips</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
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

        {trips?.length === 0 && (
          <p className="py-10 text-center text-ink-secondary">
            No trips yet. Name one above — you can work out the dates later.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {trips?.map((trip) => (
            <Card key={trip.id}>
              <Link
                to={`/t/${trip.id}`}
                className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-sunken"
              >
                <span className="min-w-0 truncate font-medium">{trip.name}</span>
                <span className="text-2xs text-ink-muted">{trip.role}</span>
              </Link>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
