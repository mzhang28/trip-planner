export type CoordinateParseResult =
  | { coordinates: { lat: number; lng: number }; error?: never }
  | { coordinates?: never; error: string };

/** Parses the `latitude, longitude` pair copied from Google Maps. */
export function parseCoordinatePair(value: string): CoordinateParseResult {
  const number = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;
  const match = value.trim().match(new RegExp(String.raw`^(${number})\s*,\s*(${number})$`));

  if (!match) {
    return { error: 'Use latitude, longitude, like 34.89155, 135.80449.' };
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);

  if (lat < -90 || lat > 90) return { error: 'Latitude must be between -90 and 90.' };
  if (lng < -180 || lng > 180) return { error: 'Longitude must be between -180 and 180.' };

  return { coordinates: { lat, lng } };
}
