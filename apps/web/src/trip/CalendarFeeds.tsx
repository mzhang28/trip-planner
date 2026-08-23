import { Button, Card, TextField } from '@trip/ui';
import { CalendarPlus, Check, Copy, ExternalLink, Rss } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CalendarFeed, type NewCalendarFeed } from '../lib/api';

/**
 * Puts the trip in somebody's calendar app and keeps it there.
 *
 * A subscription is not an export. The client goes back to the URL on its own
 * schedule, so an event moved here turns up on a phone with nobody sending
 * anything — which is the thing a downloaded `.ics` cannot do, and the reason
 * an itinerary emailed round is out of date the day after it is sent.
 *
 * Each URL is one feed, so a device can be cut off on its own. The token is
 * kept only as a hash, so it is shown once and cannot be read back: making
 * another is the way out of losing one, and is what you want anyway when the
 * device that had the old one is gone.
 */

/** Where Google takes a URL to subscribe to, rather than to import once. */
function googleCalendarUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;
}

function on(at: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(at);
}

/**
 * How long ago, in the roughest terms that are still useful.
 *
 * What this answers is "is something actually polling this": an hour ago means
 * yes, three weeks ago means the subscription was removed at the other end and
 * nobody said so.
 */
function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);

  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return days < 30 ? `${days} days ago` : on(at);
}

export function CalendarFeeds({ tripId }: { tripId: string }) {
  const [label, setLabel] = useState('');
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [made, setMade] = useState<NewCalendarFeed | null>(null);
  const [copied, setCopied] = useState(false);
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [unreachable, setUnreachable] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    // A slower earlier answer must not overwrite a faster later one: the list
    // reloads after every change, so two are often in flight.
    const ticket = ++latest.current;

    try {
      const { feeds: found } = await api.listCalendarFeeds(tripId);
      if (ticket !== latest.current) return;

      setFeeds(found);
      setUnreachable(false);
    } catch {
      /*
       * This needs the server. An empty list would say there are no
       * subscriptions, which is a different and more alarming thing than not
       * knowing — someone would make a second feed for a device that already
       * has one.
       */
      if (ticket === latest.current) setUnreachable(true);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function make() {
    try {
      const feed = await api.createCalendarFeed(tripId, {
        label: label.trim() || undefined,
        confirmedOnly,
      });

      setMade(feed);
      setCopied(false);
      setFailed(null);
      setLabel('');
      await load();
    } catch {
      // Only the server can mint one, so this URL does not exist. A pressed
      // button and no URL reads as a broken app.
      setFailed(
        'That did not reach the server, so no address was made. Try again when you are back on.',
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
      // selectable, so there is still a way to take the address.
    }
  }

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="What it is for"
            className="min-w-40 flex-1"
            placeholder="My phone"
            value={label}
            onChange={setLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void make();
            }}
          />

          <label className="flex h-9 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              data-testid="feed-confirmed-only"
              checked={confirmedOnly}
              onChange={(e) => setConfirmedOnly(e.currentTarget.checked)}
              className="size-4 rounded-sm border-line-input accent-accent"
            />
            Confirmed plans only
          </label>

          <Button variant="primary" data-testid="make-calendar-feed" onPress={() => void make()}>
            <Rss className="size-4" />
            Make an address
          </Button>
        </div>

        <p className="mt-2 text-2xs text-ink-muted">
          {confirmedOnly
            ? 'Only what is confirmed. Ideas stay out of the calendar until they are booked.'
            : 'Everything with a date on it. Ideas go in too, marked as not settled, so they do not show you as busy.'}
        </p>
      </Card>

      {failed && (
        <p data-testid="feed-failed" className="mb-4 text-sm text-danger">
          {failed}
        </p>
      )}

      {made && (
        <div className="mb-5 rounded-md border border-line bg-sunken p-3">
          <p className="mb-2 text-xs text-ink-secondary">
            Anyone with this address can read the itinerary, without signing in. Copy it now — it
            cannot be shown again, though you can make another or revoke this one whenever you like.
          </p>

          <code
            data-testid="calendar-feed-url"
            className="mb-2 block truncate rounded-sm bg-card px-2 py-1.5 text-xs"
          >
            {made.url}
          </code>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onPress={() => void copy()}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>

            {/*
              Two ways in, because "add a calendar by URL" is buried in both.
              Google takes the address as a parameter; everything else on a
              phone or a desktop answers to webcal:, which opens whichever
              calendar app is installed with the address already filled in.
            */}
            <a
              href={googleCalendarUrl(made.url)}
              target="_blank"
              rel="noreferrer"
              data-testid="add-to-google"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-default bg-card px-2.5 text-xs font-medium whitespace-nowrap text-ink shadow-xs hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Add to Google Calendar
            </a>

            <a
              href={made.webcalUrl}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-default bg-card px-2.5 text-xs font-medium whitespace-nowrap text-ink shadow-xs hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <CalendarPlus aria-hidden="true" className="size-3.5" />
              Open in a calendar app
            </a>
          </div>
        </div>
      )}

      {unreachable && (
        <div
          data-testid="feeds-unreachable"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-sunken p-3"
        >
          <p className="min-w-0 flex-1 text-sm text-ink-secondary">
            The subscriptions could not be loaded, so what is below is not the whole picture.
          </p>
          <Button size="sm" onPress={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      <h3 className="mb-2 text-sm text-ink">Addresses that work</h3>

      {feeds.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          {unreachable ? 'Not known while the server is out of reach.' : 'None yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {feeds.map((feed) => (
            <li
              key={feed.id}
              data-testid="calendar-feed"
              className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 text-sm text-ink">
                {feed.label ?? 'A calendar subscription'}
                <span className="block text-2xs text-ink-muted">
                  {feed.confirmedOnly ? 'Confirmed plans only' : 'Everything with a date'} · made{' '}
                  {on(feed.createdAt)} by {feed.createdByName} ·{' '}
                  {/*
                    Whether anything is reading it. A subscription is set up in
                    another app and never reports back, so a feed that has never
                    been fetched is the sign the address did not take.
                  */}
                  {feed.lastFetchedAt === null
                    ? 'not fetched yet'
                    : `last fetched ${ago(feed.lastFetchedAt)}`}
                </span>
              </span>

              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onPress={async () => {
                  await api.revokeCalendarFeed(tripId, feed.id);
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
        Revoking stops that address answering. A calendar already subscribed to it keeps whatever it
        last fetched until somebody removes the subscription at their end.
      </p>
    </>
  );
}
