import { describe, expect, test } from 'vitest';
import { airportRoutes, readAirport } from './airports';

describe('airport data', () => {
  test('reads airport names containing commas and their IANA zones', () => {
    const airport = readAirport(
      '1,"Example Airport, International","Example City","Example Country","EXP","EXMP",1.25,2.5,30,1,"N","Europe/Paris","airport","OurAirports"',
    );

    expect(airport).toMatchObject({
      code: 'EXP',
      name: 'Example Airport, International',
      city: 'Example City',
      timezone: 'Europe/Paris',
    });
  });

  test('finds an exact IATA code in the vendored OpenFlights data', async () => {
    const response = await airportRoutes().request('/search?q=NRT');
    const body = (await response.json()) as {
      airports: Array<{ code: string; name: string; timezone: string }>;
    };

    expect(body.airports[0]).toMatchObject({
      code: 'NRT',
      name: 'Narita International Airport',
      timezone: 'Asia/Tokyo',
    });
  });
});
