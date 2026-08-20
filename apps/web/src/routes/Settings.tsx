import { Button, Card, ThemeToggle } from '@trip/ui';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { buildLabel } from '../lib/build';
import { useAppUpdate, type UpdateStatus } from '../lib/useAppUpdate';
import { useIdentity } from '../lib/useIdentity';

/**
 * What is true of this server, and of the copy of the app on this device.
 *
 * The server half is only for the first person to arrive: registration shut
 * behind them, and whether to open it again is the one decision that is theirs
 * alone. Which build is installed here concerns whoever is holding the phone,
 * so that half is shown to everybody.
 */
export function Settings() {
  const state = useIdentity();
  const identity = state.status === 'ready' ? state.identity : null;

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

      <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-6 overflow-y-auto px-4 py-8 sm:px-6">
        <ThisApp />

        {identity && !identity.admin ? (
          <p className="text-sm text-ink-secondary">
            Who may join this server is up to whoever runs it, which is not you.
          </p>
        ) : (
          <WhoMayJoin registrationOpen={identity?.registrationOpen ?? false} />
        )}
      </main>
    </div>
  );
}

function WhoMayJoin({ registrationOpen: openOnArrival }: { registrationOpen: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // Until something is changed here, what the server said on the way in.
  const registrationOpen = open ?? openOnArrival;

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
    <Card className="p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-medium text-ink">Who may join</h2>
      <p className="mb-4 text-xs text-ink-secondary">
        This shut behind you when you arrived. A share link still lets somebody in whether it is
        open or not — opening it is only for letting people start on their own.
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
  );
}

/**
 * Which build is installed here, and how to trade it for a newer one.
 *
 * Installed from the home screen, the app opens from what it has cached, and no
 * amount of reloading changes that on its own. Somebody who has had it open for
 * a fortnight has no other way to find out that the version they are using is
 * not the one that is deployed.
 */
function ThisApp() {
  const { status, checkedAt, available, check, install } = useAppUpdate();
  const busy = status === 'checking' || status === 'installing';

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-medium text-ink">This app</h2>

      {/* Two columns, so the two stamps line up under each other and the
          difference between them is the part that reads. */}
      <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-secondary">Your version</dt>
        <dd className="font-mono text-ink" data-testid="app-version">
          {buildLabel()}
        </dd>

        {status === 'ready' && available && (
          <>
            <dt className="text-ink-secondary">Available</dt>
            <dd className="font-mono text-ink" data-testid="available-version">
              {buildLabel(available)}
            </dd>
          </>
        )}
      </dl>

      <p className="mb-3 text-sm text-ink-secondary" data-testid="update-state">
        {note(status, checkedAt)}
      </p>

      {status !== 'unsupported' && (
        <Button
          variant={status === 'ready' ? 'primary' : 'secondary'}
          isDisabled={busy}
          onPress={status === 'ready' ? install : check}
        >
          {LABELS[status]}
        </Button>
      )}
    </Card>
  );
}

const LABELS: Record<UpdateStatus, string> = {
  unsupported: 'Check for updates',
  current: 'Check for updates',
  checking: 'Checking',
  ready: 'Update and reload',
  installing: 'Reloading',
  offline: 'Check for updates',
  unreachable: 'Try again',
};

function note(status: UpdateStatus, checkedAt: number | null): string {
  switch (status) {
    case 'unsupported':
      return 'This browser keeps no copy of the app, so a reload gets the newest version.';
    case 'checking':
      return 'Checking for updates.';
    case 'ready':
      return 'An update is available. Installing it reloads the page.';
    case 'installing':
      return 'Updating.';
    case 'offline':
      return 'No network, so the server could not be asked.';
    case 'unreachable':
      return 'The server could not be reached.';
    case 'current':
      return checkedAt ? `Up to date, as of ${clock(checkedAt)}.` : 'Not checked yet.';
  }
}

/** The time of a check, which is only ever read against the clock on the wall. */
function clock(at: number): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(at);
}
