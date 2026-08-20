/** When a build was made, and the commit it was made from where that was known. */
export interface BuildStamp {
  commit: string;
  builtAt: string;
}

/**
 * Which build of the client this browser is running.
 *
 * Nothing here is released under a version number, so what names a build is
 * when it was made plus the commit behind it. Written into the bundle by
 * vite.config.ts, which puts the same pair in version.json beside it.
 */
export const APP_BUILD: BuildStamp = __APP_BUILD__;

/**
 * The build the server is handing out now, or null if it would not say.
 *
 * Fetched rather than read from the bundle, because the point of asking is that
 * this bundle may be the old one. Offline, and on any server that has no such
 * file, this is null and the build simply goes unnamed.
 */
export async function serverBuild(): Promise<BuildStamp | null> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;

    const { commit, builtAt } = body as Partial<BuildStamp>;
    return typeof commit === 'string' && typeof builtAt === 'string' ? { commit, builtAt } : null;
  } catch {
    return null;
  }
}

/** A build written for someone reading it on the settings screen. */
export function buildLabel(stamp: BuildStamp = APP_BUILD): string {
  // To the second, because two builds an hour apart is a deployment and two
  // builds a minute apart is somebody deploying twice -- both have to read as
  // different versions when they are put side by side here.
  const when = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(stamp.builtAt));

  return stamp.commit ? `${when} · ${stamp.commit}` : when;
}
