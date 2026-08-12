export interface TripSummary {
  id: string;
  name: string;
  homeTimezone: string;
  role: 'viewer' | 'editor' | 'owner';
  lastOpenedAt?: number;
  archivedAt?: number | null;
  /** What the card shows so one trip can be told from the next. */
  startsAt?: number | null;
  endsAt?: number | null;
  destination?: string | null;
  moreCities?: number;
  nextAt?: number | null;
}

/**
 * A request the server answered, and refused.
 *
 * Carries the status so a caller can tell a trip that is not there from one it
 * may not read -- and both of those from a request that never arrived, which
 * throws a plain error instead. "It is gone" and "the train is in a tunnel"
 * call for different words on screen, and guessing between them loses work.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${code} (${status})`);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error ?? `${path} returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface ImportedTrip extends TripSummary {
  events: number;
  files: number;
  /**
   * Attachments the archive had no bytes for, by the name they were saved
   * under. Empty for an archive that travelled whole.
   */
  droppedFiles: string[];
}

/**
 * Sends an archive as its own bytes.
 *
 * Not through `request`, which puts a JSON content type on everything it sends.
 * A zip inside a JSON body would have to be base64, which is a third more to
 * upload than the file already is -- and this is the largest thing the app
 * sends anywhere.
 */
async function importTrip(archive: File): Promise<ImportedTrip> {
  const response = await fetch('/api/trips/import', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: archive,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error ?? `import returned ${response.status}`);
  }

  return response.json() as Promise<ImportedTrip>;
}

export const api = {
  listTrips: () => request<{ trips: TripSummary[] }>('/api/trips'),

  importTrip,

  /** The download itself, which is a link rather than a request. */
  exportUrl: (tripId: string) => `/api/trips/${tripId}/export`,

  createTrip: (name: string, homeTimezone: string) =>
    request<TripSummary>('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name, homeTimezone }),
    }),

  getTrip: (tripId: string) => request<TripSummary>(`/api/trips/${tripId}`),

  createShareLink: (tripId: string, role: 'viewer' | 'editor', expiresInDays?: number) =>
    request<{ token: string; role: string }>(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify(expiresInDays ? { role, expiresInDays } : { role }),
    }),

  updateTrip: (
    tripId: string,
    changes: { name?: string; homeTimezone?: string; archived?: boolean },
  ) =>
    request<{ ok: true }>(`/api/trips/${tripId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteTrip: (tripId: string) =>
    request<{ ok: true }>(`/api/trips/${tripId}`, { method: 'DELETE' }),

  redeemShareLink: (token: string) =>
    request<{ tripId: string; role: string }>(`/api/share/${token}`, { method: 'POST' }),
};

/** The device's own zone, which is the right default for a trip being planned. */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
