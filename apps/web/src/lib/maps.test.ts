import { describe, expect, it } from 'vitest';
import { googleMapsUrl } from './maps';

const search = 'https://www.google.com/maps/search/?api=1&query=';

describe('opening a place in Google Maps', () => {
  it('searches for the name, the address and the city together', () => {
    expect(
      googleMapsUrl({
        label: 'Fushimi Inari Taisha',
        address: '68 Fukakusa Yabunouchicho',
        city: 'Kyoto',
      }),
    ).toBe(`${search}Fushimi%20Inari%20Taisha%2C%2068%20Fukakusa%20Yabunouchicho%2C%20Kyoto`);
  });

  it('does not repeat a city the address already names', () => {
    expect(googleMapsUrl({ label: 'Kyoto Station', city: 'Kyoto' })).toBe(
      `${search}Kyoto%20Station`,
    );
  });

  it('prefers coordinates, which are pasted in when a name will not find it', () => {
    expect(
      googleMapsUrl({ label: 'Byodo-in Temple', lat: 34.891549, lng: 135.804485, city: 'Uji' }),
    ).toBe(`${search}34.891549%2C135.804485`);
  });

  it('follows a link that already points at Maps', () => {
    const long = 'https://www.google.com/maps/place/Byodo-in/@34.8915,135.8044,17z';
    expect(googleMapsUrl({ label: long })).toBe(long);

    const shared = 'https://maps.app.goo.gl/aBcDeF123';
    expect(googleMapsUrl({ label: shared, city: 'Uji' })).toBe(shared);

    // A country domain, and a link that arrived in the address rather than the
    // name.
    const jp = 'https://maps.google.co.jp/maps?q=35.6586,139.7454';
    expect(googleMapsUrl({ label: 'Tokyo Tower', address: jp })).toBe(jp);
  });

  it('treats a link that is not a map as words to search for', () => {
    expect(googleMapsUrl({ label: 'https://www.google.com/search?q=byodo+in' })).toBe(
      `${search}https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dbyodo%2Bin`,
    );
    expect(googleMapsUrl({ label: 'https://goo.gl/xYz123' })).toBe(
      `${search}https%3A%2F%2Fgoo.gl%2FxYz123`,
    );
  });

  it('has nowhere to send anybody when the event says no place at all', () => {
    expect(googleMapsUrl({})).toBeNull();
    expect(googleMapsUrl({ label: '   ' })).toBeNull();
  });
});
