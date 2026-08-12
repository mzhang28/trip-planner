import { Button, Card, ThemeToggle } from '@trip/ui';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useIdentity } from '../lib/useIdentity';

/**
 * What is true of the server rather than of any one trip.
 *
 * Only the first person to arrive sees this. Registration shut behind them, and
 * whether to open it again is the one decision that is theirs alone.
 */
export function Settings() {
  const state = useIdentity();
  const identity = state.status === 'ready' ? state.identity : null;

  const [open, setOpen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // Until something is changed here, what the server said on the way in.
  const registrationOpen = open ?? identity?.registrationOpen ?? false;

  async function set(next: boolean) {
    setSaving(true);
    try {
      const result = await api.setRegistrationOpen(next);
      setOpen(result.registrationOpen);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              aria-label="Back to trips"
              className="rounded-md p-1 text-ink-secondary hover:bg-sunken hover:text-ink"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Link>
            <h1 className="text-lg">Settings</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        {identity && !identity.admin ? (
          <p className="text-sm text-ink-secondary">
            These are for whoever runs this server, which is not you. Nothing here affects your own
            trips.
          </p>
        ) : (
          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-medium text-ink">Who may join</h2>
            <p className="mb-4 text-xs text-ink-secondary">
              This shut behind you when you arrived. A share link still lets somebody in whether it
              is open or not — opening it is only for letting people start on their own.
            </p>

            <p className="mb-3 text-sm text-ink" data-testid="registration-state">
              {registrationOpen
                ? 'Anyone who opens this server gets an account.'
                : 'Only people you send a share link to can get an account.'}
            </p>

            <Button
              variant={registrationOpen ? 'danger' : 'secondary'}
              isDisabled={saving}
              onPress={() => void set(!registrationOpen)}
            >
              {registrationOpen ? 'Stop letting people in' : 'Let anyone join'}
            </Button>
          </Card>
        )}
      </main>
    </div>
  );
}
