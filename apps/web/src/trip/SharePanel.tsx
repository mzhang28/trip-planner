import { Button, Card, SegmentedControl, cn } from '@trip/ui';
import { Check, Copy, Share2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

type Role = 'viewer' | 'editor';

const ROLES = [
  { value: 'viewer', label: 'Can read' },
  { value: 'editor', label: 'Can edit' },
] as const;

/*
 * How long a link works for. The server has always taken an expiry and the
 * panel never offered one, so every link ever made lasted until somebody
 * remembered to revoke it.
 */
const LIVES_FOR = [
  { value: 0, label: 'Until revoked' },
  { value: 1, label: 'A day' },
  { value: 7, label: 'A week' },
  { value: 30, label: 'A month' },
];

interface AccessLink {
  id: string;
  role: Role | 'owner';
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

interface Member {
  userId: string;
  role: Role | 'owner';
  name: string;
  firstOpenedAt: number;
}

/** Reads after "a link that", or after a person's name. */
const ROLE_WORD: Record<string, string> = {
  viewer: 'can read',
  editor: 'can edit',
  owner: 'owns this trip',
};

/** Reads after "lets anyone who has it". */
const ROLE_ACTION: Record<string, string> = {
  viewer: 'read this trip',
  editor: 'read and change this trip',
};

function on(at: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(at);
}

/**
 * Who can reach this trip, and how to change that.
 *
 * Sharing used to make one editor link, print the raw URL, and say it was shown
 * once — with no way to copy it, no read-only option though the server has
 * always had one, and nothing afterwards saying whether it still worked or how
 * to take it back.
 */
export function SharePanel({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const [role, setRole] = useState<Role>('editor');
  const [days, setDays] = useState(0);
  const [made, setMade] = useState<{ url: string; role: Role } | null>(null);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<AccessLink[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [you, setYou] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    // A slower earlier answer must not overwrite a faster later one: the panel
    // reloads on a timer and after every change, so two are often in flight.
    const ticket = ++latest.current;

    setUnreachable(false);
    try {
      const res = await fetch(`/api/trips/${tripId}/access`);
      if (!res.ok || ticket !== latest.current) return;

      const body = (await res.json()) as {
        links: AccessLink[];
        members: Member[];
        you: string;
      };

      if (ticket !== latest.current) return;

      setLinks(body.links);
      setMembers(body.members);
      setYou(body.you);
    } catch {
      /*
       * Sharing needs the server. An empty panel would say there are no links
       * and nobody on the trip, which is a different and alarming thing.
       */
      setUnreachable(true);
    }
  }, [tripId]);

  /*
   * Reloaded while the panel is open, because the thing it shows changes
   * without this device doing anything: somebody opens the link and joins.
   * A list that only loaded once said "nobody yet" for as long as it was left
   * open, which is exactly when it is being watched.
   */
  useEffect(() => {
    void load();

    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [load]);

  async function makeLink() {
    try {
      const { token } = await api.createShareLink(tripId, role, days || undefined);

      setMade({ url: `${location.origin}/join/${token}`, role });
      setCopied(false);
      setFailed(null);
      await load();
    } catch {
      // A link has to be minted by the server, so this one is not made. Saying
      // nothing left a pressed button and no link, which reads as a broken app.
      setFailed(
        'That did not reach the server, so no link was made. Try again when you are back on.',
      );
    }
  }

  async function copy() {
    if (!made) return;

    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      // No clipboard permission, or an insecure context. The box below is
      // selectable, so there is still a way to take the link.
    }
  }

  const live = links.filter((link) => link.revokedAt === null);

  return (
    <div className="fixed inset-0 z-60 grid place-items-center bg-overlay p-4">
      <Card
        raised
        role="dialog"
        aria-modal="true"
        aria-label="Share this trip"
        data-testid="share-panel"
        className="max-h-[85dvh] w-full max-w-lg overflow-auto p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">Share this trip</h2>
            <p className="text-sm text-ink-secondary">
              Anyone with a link can open the trip without signing in.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-ink-muted hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">What they can do</span>
            <SegmentedControl
              label="What the link allows"
              options={ROLES}
              value={role}
              onChange={setRole}
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-secondary">Works for</span>
            <select
              data-testid="link-lifetime"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 rounded-md border border-line-input bg-card px-2 text-xs text-ink"
            >
              {LIVES_FOR.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Button variant="primary" onPress={() => void makeLink()}>
            Make a link
          </Button>
        </div>

        {failed && (
          <p data-testid="share-failed" className="mb-4 text-sm text-danger">
            {failed}
          </p>
        )}

        {unreachable && (
          <div
            data-testid="share-unreachable"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-sunken p-3"
          >
            <p className="min-w-0 flex-1 text-sm text-ink-secondary">
              Links and members could not be loaded, so what is below is not the whole picture.
            </p>
            <Button size="sm" onPress={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        {made && (
          <div className="mb-5 rounded-md border border-line bg-sunken p-3">
            <p className="mb-2 text-xs text-ink-secondary">
              {/*
                What it does and what happens next, rather than a warning with
                no action attached. The old text said it was shown once and left
                the reader to work out whether that mattered.
              */}
              This link lets anyone who has it {ROLE_ACTION[made.role]}. Copy it now — it cannot be
              shown again, though you can make another or revoke this one at any time.
            </p>

            <div className="flex items-center gap-2">
              <code
                data-testid="share-url"
                className="min-w-0 flex-1 truncate rounded-sm bg-card px-2 py-1.5 text-xs"
              >
                {made.url}
              </code>
              <Button size="sm" onPress={() => void copy()}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>

              {/* Handing a link to somebody standing next to you is the common
                  case on a phone, and the browser already knows how. */}
              {typeof navigator.share === 'function' && (
                <Button
                  size="sm"
                  onPress={() =>
                    void navigator
                      .share({ title: 'Trip', url: made.url })
                      .catch(() => setFailed(null))
                  }
                >
                  <Share2 className="size-3.5" />
                  Share
                </Button>
              )}
            </div>
          </div>
        )}

        <section className="mb-5">
          <h3 className="mb-2 text-sm text-ink">Links you have made</h3>

          {live.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              {unreachable
                ? 'Not known while the server is out of reach.'
                : 'None. Nobody can join without one.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {live.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 text-sm text-ink">
                    A link that {ROLE_WORD[link.role]}
                    <span className="block text-2xs text-ink-muted">
                      made {on(link.createdAt)}
                      {link.expiresAt && ` · runs out ${on(link.expiresAt)}`}
                    </span>
                  </span>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onPress={async () => {
                      await fetch(`/api/trips/${tripId}/access/links/${link.id}/revoke`, {
                        method: 'POST',
                      });
                      await load();
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-2xs text-ink-muted">
            Revoking stops anyone new joining with that link. People who already used it stay on the
            trip until you remove them below.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-sm text-ink">On this trip</h3>

          <ul className="flex flex-col gap-1">
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {member.name}
                  {member.userId === you && ' (you)'}
                  <span className="block text-2xs text-ink-muted">{ROLE_WORD[member.role]}</span>
                </span>

                {member.userId !== you && member.role !== 'owner' && (
                  <label className="flex items-center gap-1 text-2xs text-ink-secondary">
                    <span className="sr-only">What {member.name} can do</span>
                    <select
                      data-testid={`member-role-${member.userId}`}
                      value={member.role}
                      onChange={async (e) => {
                        await fetch(`/api/trips/${tripId}/access/members/${member.userId}`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ role: e.target.value }),
                        });
                        await load();
                      }}
                      className="h-7 rounded-md border border-line-input bg-card px-1 text-xs text-ink"
                    >
                      <option value="viewer">Can read</option>
                      <option value="editor">Can edit</option>
                    </select>
                  </label>
                )}

                {member.userId !== you && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('text-danger')}
                    onPress={async () => {
                      await fetch(`/api/trips/${tripId}/access/members/${member.userId}`, {
                        method: 'DELETE',
                      });
                      await load();
                    }}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </Card>
    </div>
  );
}
