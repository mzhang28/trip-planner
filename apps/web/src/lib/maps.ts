/** What an event says about where it is, in the parts a map can be asked for. */
export interface MapsPlace {
  label?: string;
  address?: string;
  lat?: number;
  lng?: number;
  city?: string;
}

/**
 * Where to send somebody who wants this place on a map, or null if the event
 * does not say where it is.
 *
 * A place written down as a Google Maps link is followed as it stands: that is
 * the pin somebody was looking at, which a name and a city can only
 * approximate. Failing that, coordinates, which are pasted in exactly when the
 * name is not enough to find the place by. Otherwise the words are handed to
 * Maps as a search, which is what a person would type themselves.
 */
export function googleMapsUrl(place: MapsPlace): string | null {
  const pasted = mapsLink(place.label) ?? mapsLink(place.address);
  if (pasted) return pasted;

  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    return search(`${place.lat},${place.lng}`);
  }

  const words: string[] = [];
  for (const part of [place.label, place.address, place.city]) {
    const text = part?.trim();
    if (!text) continue;

    // The city is usually in the address already, and Maps reads a place named
    // twice as two places to look for.
    if (words.some((seen) => seen.toLowerCase().includes(text.toLowerCase()))) continue;
    words.push(text);
  }

  return words.length > 0 ? search(words.join(', ')) : null;
}

/**
 * The link, if this text is a link to Google Maps.
 *
 * Somebody with the place already open in Maps copies the link rather than
 * retyping the name, so this arrives in the place field as often as a name
 * does -- both the long link from the address bar and the short one the share
 * sheet makes.
 */
function mapsLink(value: string | undefined): string | null {
  if (!value) return null;

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();

  // The share sheet's own host is only ever Maps. goo.gl is shortened
  // everything, so it counts only under /maps.
  if (host === 'maps.app.goo.gl') return url.toString();
  if (host === 'goo.gl') return path(url) === 'maps' ? url.toString() : null;

  // google.com, google.co.jp, and the rest of the country domains Maps answers
  // on, where a map is either the subdomain or the first part of the path.
  if (!/(^|\.)google\.[a-z]{2,}(\.[a-z]{2,})?$/.test(host)) return null;
  return host.startsWith('maps.') || path(url) === 'maps' ? url.toString() : null;
}

function path(url: URL): string {
  return url.pathname.split('/')[1] ?? '';
}

/** The documented form of a Maps search link, which every platform honours. */
function search(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
