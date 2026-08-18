import { Button, Card, TextField, ThemeToggle } from '@trip/ui';
import { Plus, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, api, deviceTimezone, type ImportedTrip, type TripSummary } from '../lib/api';
import { useIdentity } from '../lib/useIdentity';
import { loadTripList, saveTripList } from '../trip/storage';

/**
 * What went wrong, in words about the file rather than about the server.
 *
 * Somebody importing a trip has a file in their hand and one question about it.
 * "bad_manifest" answers a different question, and "import failed" answers
 * none: whether to look for a better copy, or to go and make one.
 */
const IMPORT_PROBLEMS: Record<string, string> = {
  not_a_zip: 'That file is not a trip archive.',
  no_manifest: 'That zip has no trip in it. It may be the wrong file.',
  bad_manifest: 'That archive is damaged, or was not written by this app.',
  unsupported_version:
    'That archive comes from a newer version than this one, which cannot read it.',
  file_corrupt: 'That archive is damaged: one of its files is not the file it claims to be.',
  too_large: 'That archive is too large to import.',
  empty: 'That file is empty.',
};

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
  // Only whoever put the server up has anything to change about it.
  const state = useIdentity();
  const admin = state.status === 'ready' && state.identity.admin;

  const [trips, setTrips] = useState<TripSummary[] | null>(null);

  /*
   * A list that could not be fetched used to become an empty list, which reads
   * as "you have no trips" -- and somebody who believes that starts again from
   * nothing while their trips sit on the server.
   */
  const [unreachable, setUnreachable] = useState(false);

  /*
   * The list on screen is the one saved on this device, because the server did
   * not answer. The trips it links to open from IndexedDB, so it is worth
   * showing; it is a snapshot, so it is worth saying so.
   */
  const [fromCache, setFromCache] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    setUnreachable(false);
    void api
      .listTrips()
      .then((res) => {
        setTrips(res.trips);
        setFromCache(false);
        void saveTripList(res.trips);
      })
      .catch(async () => {
        // Offline: fall back to the list saved on this device. Only when there
        // is none -- a first run that has never reached the server -- is there
        // nothing to show but the failure.
        const cached = await loadTripList();
        if (cached && cached.length > 0) {
          setTrips(cached);
          setFromCache(true);
        } else {
          setUnreachable(true);
        }
      });
  }, []);

  useEffect(load, [load]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const trip = await api.createTrip(trimmed, deviceTimezone());
    void navigate(`/t/${trip.id}`);
  }

  const archiveInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProblem, setImportProblem] = useState<string | null>(null);

  /** An import that arrived short of some of its files, and so has to be read. */
  const [incomplete, setIncomplete] = useState<ImportedTrip | null>(null);

  async function importArchive(archive: File) {
    setImporting(true);
    setImportProblem(null);
    setIncomplete(null);

    try {
      const trip = await api.importTrip(archive);

      /*
       * A trip that arrived whole is opened, the same as one just created.
       * One missing attachments stops here instead: this is the only notice
       * anybody gets that part of the archive did not survive, and navigating
       * away from it would be the same as not saying so at all.
       */
      if (trip.droppedFiles.length === 0) {
        void navigate(`/t/${trip.id}`);
        return;
      }

      setIncomplete(trip);
      load();
    } catch (error) {
      setImportProblem(
        (error instanceof ApiError ? IMPORT_PROBLEMS[error.code] : null) ??
          'That trip could not be imported.',
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="shrink-0 border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <h1 className="text-lg">Trips</h1>
          <div className="flex items-center gap-2">
            <Link
              to="/agents"
              className="rounded-md px-2 py-1 text-sm text-ink-secondary hover:bg-sunken hover:text-ink"
            >
              Agents
            </Link>
            {admin && (
              <Link
                to="/settings"
                className="rounded-md px-2 py-1 text-sm text-ink-secondary hover:bg-sunken hover:text-ink"
              >
                Settings
              </Link>
            )}
            <ThemeToggle />
          </div>
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

          <input
            ref={archiveInput}
            type="file"
            accept=".zip,application/zip"
            aria-label="Trip archive to import"
            className="sr-only"
            data-testid="import-trip-input"
            onChange={(e) => {
              const archive = e.currentTarget.files?.[0];
              // Cleared so that choosing the same file again still fires, which
              // is exactly what somebody does after an import goes wrong.
              e.currentTarget.value = '';
              if (archive) void importArchive(archive);
            }}
          />
          <Button
            data-testid="import-trip"
            isDisabled={importing}
            onPress={() => archiveInput.current?.click()}
          >
            <Upload aria-hidden="true" className="size-4" />
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>

        {importProblem && (
          <p
            data-testid="import-problem"
            className="mb-8 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-danger"
          >
            {importProblem}
          </p>
        )}

        {incomplete && (
          <div
            data-testid="import-incomplete"
            className="mb-8 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-secondary"
          >
            <p>
              <Link to={`/t/${incomplete.id}`} className="text-accent-text underline">
                {incomplete.name}
              </Link>{' '}
              was imported, but the archive had no bytes for{' '}
              {incomplete.droppedFiles.length === 1
                ? 'one file'
                : `${incomplete.droppedFiles.length} files`}
              , so {incomplete.droppedFiles.length === 1 ? 'it is' : 'they are'} not on the trip:{' '}
              {incomplete.droppedFiles.join(', ')}.
            </p>
            <p className="mt-1 text-2xs text-ink-muted">
              Everything else came through. Attaching them again is the only way back.
            </p>
          </div>
        )}

        {fromCache && (
          <div
            data-testid="trips-from-cache"
            className="mb-8 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-secondary"
          >
            The server did not answer, so this is the list saved on this device. It may be out of
            date, and a trip not opened here before will be empty until you are back online.
          </div>
        )}

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
              <Link to={`/t/${trip.id}`} className="flex flex-col gap-1 px-3 py-3 hover:bg-sunken">
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
