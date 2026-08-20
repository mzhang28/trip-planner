import { useCallback, useEffect, useRef, useState } from 'react';
import { serverBuild, type BuildStamp } from './build';

/**
 * Where this device stands against the copy of the app on the server.
 *
 * An installed app runs the files its service worker cached, and goes on
 * running them until a new worker takes over from the old one. The browser
 * looks for a new worker on its own schedule -- on a navigation, and at most
 * once a day -- so a phone that never closes the app can sit on a build from
 * weeks ago and have no way of knowing.
 *
 * `unsupported` is a browser with no service worker, where there is no cache in
 * front of the app and a reload already fetches whatever the server has.
 */
export type UpdateStatus =
  'unsupported' | 'current' | 'checking' | 'ready' | 'installing' | 'offline' | 'unreachable';

export interface AppUpdate {
  status: UpdateStatus;
  /** When the server was last asked, if it has been asked since this page opened. */
  checkedAt: number | null;
  /** The build that is waiting, once there is one and the server has named it. */
  available: BuildStamp | null;
  /** Asks the server now, rather than waiting for the browser to get around to it. */
  check: () => void;
  /** Hands the page over to the waiting build, which reloads it. */
  install: () => void;
}

/**
 * How long to wait for the new worker to take control before reloading anyway.
 *
 * Reloading without the handover is not harmful: the request for index.html is
 * answered `no-cache`, so it reaches the server and comes back with the new
 * build's assets. This only exists so the button cannot sit on "Reloading"
 * forever if the handover never lands.
 */
const HANDOVER_WAIT = 3000;

export function useAppUpdate(): AppUpdate {
  const supported = 'serviceWorker' in navigator;

  const [status, setStatus] = useState<UpdateStatus>(supported ? 'current' : 'unsupported');
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [available, setAvailable] = useState<BuildStamp | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  const ask = useCallback((reg: ServiceWorkerRegistration) => {
    /*
     * The browser is asked before the worker is, because the worker would not
     * say. Its request for a new version does not go through this page, and
     * with no network it can come back reporting nothing new rather than
     * failing -- which would read here as "up to date" on a phone that has not
     * spoken to the server in a week.
     */
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }

    setStatus('checking');

    void reg.update().then(
      () => {
        setCheckedAt(Date.now());

        // A worker still downloading is left alone: the `updatefound` handler
        // below moves this to `ready` once it has finished and is waiting.
        if (reg.waiting) setStatus('ready');
        else if (!reg.installing) setStatus('current');
      },
      // update() rejects when the request for the worker fails: the link went
      // during the check, or the server did not answer.
      () => setStatus('unreachable'),
    );
  }, []);

  useEffect(() => {
    if (!supported) return;

    let live = true;
    const stopListening: Array<() => void> = [];

    // `ready` rather than getRegistration(): the worker is registered from a
    // load handler in index.html, which has not necessarily run yet.
    void navigator.serviceWorker.ready.then((reg) => {
      if (!live) return;
      registration.current = reg;

      // A build downloaded on an earlier visit and never put in place, because
      // the app was never closed for the handover to happen in.
      if (reg.waiting) setStatus('ready');

      // Anything arriving from here on is a newer build, not the first one:
      // `ready` above only resolved because a worker was already active.
      const onUpdateFound = () => {
        const arriving = reg.installing;
        if (!arriving) return;

        const onStateChange = () => {
          /*
           * Two ways a new build finishes arriving. `installed` is the usual
           * one, where it waits behind the worker this page is running.
           * `activated` is what happens when no page was under the old
           * worker's control for it to wait on, and then it is in charge
           * already. Either way the page is still running the old files.
           */
          if (arriving.state === 'installed' || arriving.state === 'activated') {
            setStatus('ready');
          }

          // It could not install -- a file it needed did not come back. The
          // build running here is untouched by that.
          if (arriving.state === 'redundant') setStatus('unreachable');
        };

        arriving.addEventListener('statechange', onStateChange);
        stopListening.push(() => arriving.removeEventListener('statechange', onStateChange));
      };

      reg.addEventListener('updatefound', onUpdateFound);
      stopListening.push(() => reg.removeEventListener('updatefound', onUpdateFound));

      // Opening this screen is the question being asked, so answer it without
      // waiting to be pressed.
      ask(reg);
    });

    return () => {
      live = false;
      for (const stop of stopListening) stop();
    };
  }, [supported, ask]);

  /*
   * What is waiting is named by the server, not by the worker holding it: the
   * new build's own stamp is inside files this page cannot read. version.json
   * comes from the same deployment the waiting worker downloaded.
   */
  useEffect(() => {
    if (status !== 'ready') return;

    let live = true;
    void serverBuild().then((stamp) => {
      if (live) setAvailable(stamp);
    });

    return () => {
      live = false;
    };
  }, [status]);

  const check = useCallback(() => {
    const reg = registration.current;
    if (reg) ask(reg);
  }, [ask]);

  const install = useCallback(() => {
    const waiting = registration.current?.waiting;

    // Nothing to hand over: the new build is in charge already and only this
    // page is behind, so reading the page again is the whole job.
    if (!waiting) {
      window.location.reload();
      return;
    }

    setStatus('installing');

    /*
     * The page has to be read again from what the new worker serves, so the
     * reload waits for the handover rather than firing straight away. Nothing
     * is lost in it: every local change is written to IndexedDB as it is made.
     *
     * SKIP_WAITING is the message the generated worker listens for; it stops
     * waiting, activates, and takes over the pages the old one controlled.
     */
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    window.setTimeout(reload, HANDOVER_WAIT);

    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  return { status, checkedAt, available, check, install };
}
