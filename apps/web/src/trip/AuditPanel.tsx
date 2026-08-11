import { Button, Card, SegmentedControl, cn } from '@trip/ui';
import { useCallback, useEffect, useState } from 'react';

export interface AuditEntry {
  id: string;
  source: 'mcp' | 'web' | 'api';
  clientId: string | null;
  toolName: string;
  summary: string;
  createdAt: number;
  undoneAt: number | null;
  undoable: boolean;
  restoresFields: boolean;
  actor: string;
}

type Filter = 'mcp' | 'all';

const FILTERS = [
  { value: 'mcp', label: 'By agents' },
  { value: 'all', label: 'All recorded' },
] as const;

function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(at);
}

/**
 * What has been done to this trip by something other than a person in the app,
 * and a way to put it back.
 *
 * Filtered to agents by default, because those are the changes nobody watched
 * happen, which is what makes an undo button worth having.
 *
 * Edits made in the app are not listed. They reach the server as sync messages
 * rather than as named actions, so there is nothing to record beyond the change
 * itself -- and the person who made one was looking at it at the time.
 */
export function AuditPanel({ tripId, onUndone }: { tripId: string; onUndone: () => void }) {
  const [filter, setFilter] = useState<Filter>('mcp');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = filter === 'mcp' ? '?source=mcp' : '';

    setUnreachable(false);
    try {
      const res = await fetch(`/api/audit/${tripId}${query}`);
      if (!res.ok) throw new Error(String(res.status));

      const body = (await res.json()) as { entries: AuditEntry[] };
      setEntries(body.entries);
    } catch {
      /*
       * The log lives on the server, and there is nothing local to fall back
       * to. An empty panel would say nothing has happened, which is a claim
       * this cannot make while offline.
       */
      setUnreachable(true);
    }
  }, [tripId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function undo(entryId: string) {
    setBusy(entryId);
    try {
      await fetch(`/api/audit/${tripId}/${entryId}/undo`, { method: 'POST' });
      await load();
      onUndone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="What has been done to this trip">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm text-ink">Recent changes</h2>
        <SegmentedControl
          label="Which changes"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {unreachable ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="audit-unreachable">
          <p className="min-w-0 flex-1 text-sm text-ink-secondary">
            This list is kept on the server, which could not be reached. It is not that nothing has
            happened.
          </p>
          <Button size="sm" onPress={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        entries?.length === 0 && (
          <p className="text-sm text-ink-secondary">
            {filter === 'mcp'
              ? 'No agent has changed anything on this trip.'
              : 'Nothing has been recorded yet. Edits made here are not listed.'}
          </p>
        )
      )}

      <ul className="flex flex-col gap-2">
        {entries?.map((entry) => (
          <li key={entry.id}>
            <Card
              className={cn(
                'flex flex-wrap items-center gap-3 px-3 py-2',
                entry.undoneAt !== null && 'opacity-60',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{entry.summary}</p>
                <p className="text-2xs text-ink-muted">
                  {entry.actor} · {when(entry.createdAt)}
                  {entry.source === 'mcp' && ' · through an agent'}
                  {entry.undoneAt !== null && ' · undone'}
                </p>
              </div>

              {entry.undoneAt === null && (
                <Button
                  size="sm"
                  isDisabled={busy === entry.id}
                  onPress={() => void undo(entry.id)}
                >
                  Undo
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
