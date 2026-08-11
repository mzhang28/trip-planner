import { Button, Card, StatusChip, StatusSpine, ThemeToggle } from '@trip/ui';
import { BOOKING_STATUSES } from '@trip/crdt';
import { Plus } from 'lucide-react';
import { useOnlineStatus } from './lib/useOnlineStatus';

/**
 * A placeholder home screen. It exists so the shell, the tokens, the fonts, and
 * the service worker can be checked end to end before stage 1 replaces it with
 * the trip list and the day view.
 */
export function App() {
  const online = useOnlineStatus();

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl">Trip Planner</h1>
          <span
            className={
              online
                ? 'rounded-sm bg-booked-soft px-1.5 py-0.5 text-2xs font-medium text-booked-text'
                : 'rounded-sm bg-pending-soft px-1.5 py-0.5 text-2xs font-medium text-pending-text'
            }
          >
            {online ? 'Online' : 'Offline — changes are saved here'}
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h2 className="text-2xl">Nothing planned yet</h2>
        <p className="mt-2 max-w-prose text-ink-secondary">
          Start with a name. A place, a time, and whether it is booked can all wait until you know
          them.
        </p>

        <Button variant="primary" className="mt-5">
          <Plus className="size-4" />
          New trip
        </Button>

        <section className="mt-12">
          <h3 className="mb-3 text-sm text-ink-muted">How an event looks at each stage</h3>
          <div className="flex flex-col gap-2">
            {BOOKING_STATUSES.map((status, index) => (
              <Card key={status} className="flex overflow-hidden">
                <StatusSpine status={status} />
                <div className="flex flex-1 items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm font-medium">
                    {['Pottery studio', 'Nishiki Market lunch', 'Fushimi Inari at dawn'][index]}
                  </span>
                  <StatusChip status={status} short />
                </div>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
