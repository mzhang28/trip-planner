import type { Place } from '@trip/crdt';
import { TextField, cn } from '@trip/ui';
import { useEffect, useId, useRef, useState } from 'react';

interface PlaceResult {
  label: string;
  address?: string;
  lat: number;
  lng: number;
}

export interface PlacePickerProps {
  value: Place | undefined;
  onChange: (place: Place | undefined) => void;
}

/**
 * Finds a place, or lets someone write one down that no map knows about.
 *
 * Looking a place up is a convenience, not a requirement. A friend's flat and a
 * restaurant that has not been added to the map are both real places on a trip,
 * so whatever is typed is kept even when nothing comes back — the search only
 * offers to fill in the coordinates.
 */
export function PlacePicker({ value, onChange }: PlacePickerProps) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3 || text === value?.label) {
      setResults([]);
      return;
    }

    // Wait for a pause in typing. Nominatim allows one request a second, and
    // sending one per keystroke would spend that budget on prefixes nobody
    // meant to search for.
    const timer = setTimeout(() => {
      const ticket = ++latest.current;

      void fetch(`/api/places/search?q=${encodeURIComponent(text)}`)
        .then((res) => res.json() as Promise<{ places: PlaceResult[] }>)
        .then((body) => {
          // A slower earlier request must not overwrite a faster later one.
          if (ticket === latest.current) setResults(body.places);
        })
        .catch(() => setResults([]));
    }, 400);

    return () => clearTimeout(timer);
  }, [query, value?.label]);

  function choose(result: PlaceResult) {
    onChange({ label: result.label, address: result.address, lat: result.lat, lng: result.lng });
    setQuery(result.label);
    setResults([]);
    setOpen(false);
  }

  const showing = open && results.length > 0;

  return (
    <div className="relative">
      <TextField
        label="Place"
        placeholder="Fushimi Inari Taisha"
        description={
          value?.lat === undefined
            ? 'Found on a map, it gets a pin. Typed by hand, it still counts.'
            : `Pinned at ${value.lat.toFixed(4)}, ${value.lng!.toFixed(4)}`
        }
        value={query}
        onChange={(next) => {
          setQuery(next);
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);

          const text = query.trim();
          if (text === (value?.label ?? '')) return;

          // Keeping the words but dropping the pin: the coordinates belonged to
          // the old name and would put the marker somewhere else entirely.
          onChange(text ? { label: text } : undefined);
        }}
      />

      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching places"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-raised py-1 shadow-lg"
        >
          {results.map((result) => (
            <li key={`${result.lat},${result.lng}`}>
              <button
                type="button"
                onMouseDown={() => choose(result)}
                className={cn(
                  'block w-full px-3 py-1.5 text-left',
                  'hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none',
                )}
              >
                <span className="block truncate text-sm text-ink">{result.label}</span>
                {result.address && (
                  <span className="block truncate text-2xs text-ink-muted">{result.address}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
