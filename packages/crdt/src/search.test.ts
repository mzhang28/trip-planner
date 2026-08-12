import { describe, expect, it } from 'vitest';
import { eventSearchText } from './search';
import type { FieldDef, FieldDefId, TripEvent } from './types';

function event(overrides: Partial<TripEvent> = {}): TripEvent {
  return {
    id: 'e1',
    kind: 'activity',
    name: 'Fushimi Inari',
    booking: { status: 'idea' },
    links: {},
    attachments: {},
    customFields: {},
    updatedAt: 0,
    updatedBy: 'user-ada',
    ...overrides,
  };
}

const fieldDefs: Record<FieldDefId, FieldDef> = {
  dress: { id: 'dress', label: 'Dress code', type: 'text', order: 0 },
  cost: { id: 'cost', label: 'Cost per person', type: 'money', currency: 'JPY', order: 1 },
  walk: { id: 'walk', label: 'Walking', type: 'number', unit: 'km', order: 2 },
  booked: { id: 'booked', label: 'Deposit paid', type: 'checkbox', order: 3 },
  opens: { id: 'opens', label: 'Opens', type: 'date', order: 4 },
  extras: {
    id: 'extras',
    label: 'Extras',
    type: 'multiselect',
    order: 5,
    options: {
      guided: { label: 'Guided tour' },
      early: { label: 'Early entry' },
    },
  },
};

describe('eventSearchText', () => {
  it('covers the built-in fields a person would search by', () => {
    const text = eventSearchText(
      event({
        city: 'Kyoto',
        location: { label: 'Fushimi Inari Taisha', address: '68 Fukakusa Yabunouchicho' },
        description: 'Go before the coaches arrive',
        booking: { status: 'booked', note: 'paid in full', confirmationCode: '7K2QLM' },
        flight: {
          airline: 'ANA',
          number: 'NH017',
          from: 'NRT',
          to: 'ITM',
          fromCity: 'Tokyo',
          toCity: 'Osaka',
        },
        transit: { mode: 'transit', fromCity: 'Nara', toCity: 'Kobe' },
        lodging: { address: '15 Gionmachi' },
        transitIn: { minutes: 20, mode: 'walk', note: 'uphill the whole way' },
        links: { l1: { url: 'https://inari.jp', title: 'Official site', addedAt: 0 } },
        attachments: {
          a1: { blobHash: 'x', filename: 'tickets.pdf', mime: 'application/pdf', size: 1, addedAt: 0 },
        },
      }),
    );

    for (const needle of [
      'Fushimi Inari',
      'Kyoto',
      'Fukakusa',
      'coaches',
      'paid in full',
      '7K2QLM',
      'ANA',
      'NH017',
      'NRT',
      'ITM',
      'Tokyo',
      'Osaka',
      'Nara',
      'Kobe',
      'Gionmachi',
      'uphill',
      'Official site',
      'inari.jp',
      'tickets.pdf',
    ]) {
      expect(text, `missing ${needle}`).toContain(needle);
    }
  });

  it('renders every custom field type as it reads on screen', () => {
    const text = eventSearchText(
      event({
        customFields: {
          dress: { kind: 'text', text: 'smart casual' },
          cost: { kind: 'number', number: 4500 },
          walk: { kind: 'number', number: 3.2 },
          booked: { kind: 'bool', bool: true },
          opens: { kind: 'instant', at: Date.UTC(2026, 7, 14) },
          extras: { kind: 'options', selected: { guided: true, early: true } },
        },
      }),
      fieldDefs,
    );

    expect(text).toContain('Dress code smart casual');
    expect(text).toContain('3.2 km');
    expect(text).toContain('JPY 4500');
    expect(text).toContain('Deposit paid yes');
    expect(text).toContain('2026-08-14');
    expect(text).toContain('14 August 2026');
    expect(text).toContain('Guided tour');
    expect(text).toContain('Early entry');
  });

  it('finds an event by the name of a field that is filled in', () => {
    const text = eventSearchText(
      event({ customFields: { dress: { kind: 'text', text: 'yukata' } } }),
      fieldDefs,
    );

    expect(text.toLowerCase()).toContain('dress');
  });

  it('falls back to ids when the definition is gone, rather than dropping the value', () => {
    const text = eventSearchText(
      event({ customFields: { extras: { kind: 'options', selected: { guided: true } } } }),
      {},
    );

    // The definition was swept but the value is still on the event. Showing the
    // id beats showing nothing, because nothing looks like the field never
    // existed.
    expect(text).toContain('guided');
  });

  it('indexes a mention by the words, not by the markup around them', () => {
    const text = eventSearchText(
      event({ description: 'Meet at @[Nishiki Market](event:e2) first' }),
    );

    expect(text).toContain('Meet at Nishiki Market first');
    // An id is not something anyone would ever type into a search box.
    expect(text).not.toContain('event:e2');
    expect(text).not.toContain('@[');
  });

  it('leaves out empty and missing values instead of padding with blanks', () => {
    expect(eventSearchText(event())).toBe('Fushimi Inari');
  });
});
