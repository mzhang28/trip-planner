export interface TripSummary {
  id: string;
  name: string;
  homeTimezone: string;
  role: 'viewer' | 'editor' | 'owner';
  lastOpenedAt?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${path} returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  listTrips: () => request<{ trips: TripSummary[] }>('/api/trips'),

  createTrip: (name: string, homeTimezone: string) =>
    request<TripSummary>('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name, homeTimezone }),
    }),

  getTrip: (tripId: string) => request<TripSummary>(`/api/trips/${tripId}`),

  createShareLink: (tripId: string, role: 'viewer' | 'editor') =>
    request<{ token: string; role: string }>(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  redeemShareLink: (token: string) =>
    request<{ tripId: string; role: string }>(`/api/share/${token}`, { method: 'POST' }),
};

/** The device's own zone, which is the right default for a trip being planned. */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
