import { describe, expect, it } from 'vitest';
import { parseCoordinatePair } from './coordinates';

describe('coordinate pairs', () => {
  it('accepts the format copied from Google Maps', () => {
    expect(parseCoordinatePair('34.891549790773766, 135.80448560871287')).toEqual({
      coordinates: { lat: 34.891549790773766, lng: 135.80448560871287 },
    });
  });

  it('accepts signed coordinates and surrounding whitespace', () => {
    expect(parseCoordinatePair('  -33.8688, 151.2093  ')).toEqual({
      coordinates: { lat: -33.8688, lng: 151.2093 },
    });
  });

  it('rejects a missing comma and out-of-range values', () => {
    expect(parseCoordinatePair('34.8 135.8')).toEqual({
      error: 'Use latitude, longitude, like 34.89155, 135.80449.',
    });
    expect(parseCoordinatePair('91, 135.8')).toEqual({
      error: 'Latitude must be between -90 and 90.',
    });
    expect(parseCoordinatePair('34.8, -181')).toEqual({
      error: 'Longitude must be between -180 and 180.',
    });
  });
});
