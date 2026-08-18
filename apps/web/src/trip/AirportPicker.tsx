import { cn } from '@trip/ui';
import { MapPin, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export interface AirportResult {
  code: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
  lat: number;
  lng: number;
}

interface AirportSelection {
  code: string | undefined;
  timezone?: string;
  city?: string;
}

type Lookup =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; airports: AirportResult[] }
  | { state: 'unreachable' };

export interface AirportPickerProps {
  label: string;
  code: string | undefined;
  /** The saved endpoint city, so an older airport-only route can be completed. */
  city?: string;
  timezone: string;
  onChange: (selection: AirportSelection) => void;
}

/** Search OpenFlights by IATA, airport, or city and keep manual IATA entry. */
export function AirportPicker({ label, code, city, timezone, onChange }: AirportPickerProps) {
  const [query, setQuery] = useState(code ?? '');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [known, setKnown] = useState<AirportResult | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const latest = useRef(0);
  const choosing = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    setQuery(code ?? '');
    if (!code) setKnown(null);
  }, [code]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setLookup({ state: 'idle' });
      return;
    }

    setLookup({ state: 'searching' });
    const timer = setTimeout(() => {
      const ticket = ++latest.current;
      void fetch(`/api/airports/search?q=${encodeURIComponent(text)}`)
        .then((response) => {
          if (!response.ok) throw new Error(`Airport search failed: ${response.status}`);
          return response.json() as Promise<{ airports: AirportResult[] }>;
        })
        .then(({ airports }) => {
          if (ticket !== latest.current) return;
          setLookup({ state: 'found', airports });
          setActive(0);

          // Three letters are usually pasted from a ticket. Resolve an exact
          // code immediately, so its name and zone appear without another tap.
          const exact = airports.find(
            (airport) => airport.code === text.toUpperCase() && text.length === 3,
          );
          if (!exact) return;

          setKnown(exact);
          setOpen(false);
          if (exact.code !== code || exact.timezone !== timezone || exact.city !== city) {
            onChangeRef.current({
              code: exact.code,
              timezone: exact.timezone,
              city: exact.city || undefined,
            });
          }
        })
        .catch(() => {
          if (ticket === latest.current) setLookup({ state: 'unreachable' });
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [query, code, city, timezone]);

  const airports = lookup.state === 'found' ? lookup.airports : [];
  const showing = open && query.trim().length >= 2;

  function choose(airport: AirportResult | undefined) {
    if (!airport) return;
    choosing.current = true;
    setKnown(airport);
    setQuery(airport.code);
    setOpen(false);
    onChange({
      code: airport.code,
      timezone: airport.timezone,
      city: airport.city || undefined,
    });
  }

  function commit() {
    if (choosing.current) {
      choosing.current = false;
      return;
    }

    const raw = query.trim().toUpperCase();
    if (!raw) {
      setKnown(null);
      onChange({ code: undefined });
    } else if (/^[A-Z0-9]{3}$/.test(raw)) {
      setQuery(raw);
      if (raw !== code) onChange({ code: raw });
    } else {
      // A city or airport name is a search, not a new airport code. If no
      // result was chosen, return to the last saved value.
      setQuery(code ?? '');
    }
  }

  const status =
    lookup.state === 'searching'
      ? 'Searching airports…'
      : lookup.state === 'unreachable'
        ? 'Airport lookup is unavailable. You can still enter a 3-letter code.'
        : airports.length === 0
          ? 'No matching airport. You can still enter a 3-letter code.'
          : null;

  return (
    <div className="relative min-w-0">
      <label
        htmlFor={id}
        className="mb-1 block text-2xs font-medium tracking-wide text-ink-muted uppercase"
      >
        {label}
      </label>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-placeholder"
        />
        <input
          id={id}
          role="combobox"
          value={query}
          aria-expanded={showing}
          aria-controls={showing ? `${id}-list` : undefined}
          aria-activedescendant={
            showing && airports.length > 0 ? `${id}-option-${active}` : undefined
          }
          aria-autocomplete="list"
          placeholder="NRT or Tokyo"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setKnown(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((current) => Math.min(current + 1, airports.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter' && showing && airports.length > 0) {
              event.preventDefault();
              choose(airports[active]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setQuery(code ?? '');
            }
          }}
          className={cn(
            'h-12 w-full rounded-md border border-line-input bg-card pr-3 pl-9 font-mono text-lg font-medium tracking-wide text-ink',
            'placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-placeholder',
            'focus:border-accent focus:outline-2 focus:-outline-offset-1 focus:outline-focus',
          )}
        />
      </div>

      <div className="mt-1 min-h-8">
        {known ? (
          <>
            <p className="truncate text-xs font-medium text-ink-secondary">{known.name}</p>
            <p className="flex items-center gap-1 truncate text-2xs text-ink-muted">
              <MapPin aria-hidden="true" className="size-3 shrink-0" />
              {known.city}, {known.country}
            </p>
          </>
        ) : (
          <p className="text-2xs text-ink-muted">Search by IATA code, airport, or city.</p>
        )}
      </div>

      {showing && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} airports`}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-lg"
        >
          {status && <p className="px-3 py-2 text-sm text-ink-secondary">{status}</p>}
          {airports.map((airport, index) => (
            <button
              key={`${airport.code}-${airport.name}`}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(airport);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-2 text-left',
                index === active && 'bg-accent-soft',
              )}
            >
              <span className="w-9 shrink-0 font-mono text-sm font-medium text-ink">
                {airport.code}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{airport.name}</span>
                <span className="block truncate text-2xs text-ink-muted">
                  {airport.city}, {airport.country} · {airport.timezone}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
