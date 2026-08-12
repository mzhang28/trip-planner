import type { Place } from '@trip/crdt';
import { cn } from '@trip/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { CoordinatesPicker } from './CoordinatesPicker';

interface PlaceResult {
  label: string;
  address?: string;
  lat: number;
  lng: number;
}

/** Where the lookup has got to, which is what the field says while you wait. */
type Lookup =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; places: PlaceResult[] }
  | { state: 'unreachable' };

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
 *
 * A combobox rather than a list of things to click: results arrive after a
 * pause, and a field that can only be answered with a pointer cannot be
 * answered at all by someone typing an address on a phone keyboard.
 */
export function PlacePicker({ value, onChange }: PlacePickerProps) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const id = useId();
  const latest = useRef(0);

  /*
   * Set when a result is taken from the list.
   *
   * Choosing one blurs the field, and the blur below writes down whatever text
   * is in it as a place with no coordinates -- which threw away the pin that
   * had just been chosen, one line after it was set.
   */
  const chosen = useRef(false);

  /*
   * The pending close from the last blur.
   *
   * Closing is delayed so a click on a result lands before the list goes. Type
   * again inside that moment -- which is what changing your mind looks like --
   * and the old timer used to shut the new list a heartbeat after it opened.
   */
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stayOpen() {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
    setOpen(true);
  }

  useEffect(() => () => {
    if (closing.current) clearTimeout(closing.current);
  }, []);

  const places = lookup.state === 'found' ? lookup.places : [];

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3 || text === value?.label) {
      setLookup({ state: 'idle' });
      return;
    }

    // Wait for a pause in typing. Nominatim allows one request a second, and
    // sending one per keystroke would spend that budget on prefixes nobody
    // meant to search for.
    setLookup({ state: 'searching' });
    const timer = setTimeout(() => {
      const ticket = ++latest.current;

      void fetch(`/api/places/search?q=${encodeURIComponent(text)}`)
        .then((res) => res.json() as Promise<{ places: PlaceResult[] }>)
        .then((body) => {
          // A slower earlier request must not overwrite a faster later one.
          if (ticket === latest.current) setLookup({ state: 'found', places: body.places });
        })
        .catch(() => {
          /*
           * Said plainly rather than shown as an empty list. Offline is the
           * normal state on a trip, and "no matches" would be a lie that stops
           * somebody trying again later.
           */
          if (ticket === latest.current) setLookup({ state: 'unreachable' });
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [query, value?.label]);

  useEffect(() => setActive(0), [lookup]);

  function choose(result: PlaceResult | undefined) {
    if (!result) return;

    chosen.current = true;
    onChange({ label: result.label, address: result.address, lat: result.lat, lng: result.lng });
    setQuery(result.label);
    setLookup({ state: 'idle' });
    setOpen(false);
  }

  /** Keeps the words, drops the pin: the coordinates belonged to the old name. */
  function commitTypedText() {
    if (chosen.current) {
      chosen.current = false;
      return;
    }

    const text = query.trim();
    if (text === (value?.label ?? '')) return;

    onChange(text ? { label: text } : undefined);
  }

  const pinned = value?.lat !== undefined && value.lng !== undefined;
  const edited = query.trim() !== (value?.label ?? '');
  const showing = open && lookup.state !== 'idle';

  const message =
    lookup.state === 'searching'
      ? 'Looking…'
      : lookup.state === 'unreachable'
        ? 'Could not reach the map. What you typed is kept either way.'
        : places.length === 0
          ? 'No map match. What you typed is kept, without a pin.'
          : null;

  return (
    <div className="relative">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium text-ink-secondary">
          Place
        </label>

        <div
          className={cn(
            'flex h-9 items-center rounded-md border border-line-input bg-card pr-1 pl-2.5',
            'focus-within:border-accent focus-within:outline-focus focus-within:outline-2 focus-within:-outline-offset-1',
          )}
        >
          <input
            id={id}
            type="text"
            role="combobox"
            value={query}
            placeholder="Fushimi Inari Taisha"
            aria-expanded={showing}
            aria-controls={showing ? `${id}-list` : undefined}
            aria-activedescendant={
              showing && places.length > 0 ? `${id}-option-${active}` : undefined
            }
            aria-autocomplete="list"
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setQuery(e.target.value);
              stayOpen();
            }}
            onFocus={stayOpen}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                stayOpen();
                setActive((current) => Math.min(current + 1, places.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (e.key === 'Enter' && showing && places.length > 0) {
                e.preventDefault();
                choose(places[active]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            onBlur={() => {
              closing.current = setTimeout(() => setOpen(false), 150);
              commitTypedText();
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
          />

          <CoordinatesPicker
            lat={value?.lat}
            lng={value?.lng}
            onChange={(lat, lng) =>
              onChange({
                ...value,
                label: query.trim() || value?.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                lat,
                lng,
              })
            }
            onClear={() => {
              if (!value) return;
              const { lat: _lat, lng: _lng, ...withoutCoordinates } = value;
              onChange(withoutCoordinates);
            }}
          />
        </div>

        <span id={`${id}-hint`} className="text-2xs text-ink-muted">
          {/*
            Said before it happens rather than discovered afterwards. Retyping
            the name of a pinned place used to remove its marker silently, and
            the map simply lost the event.
          */}
          {pinned && edited
            ? 'Leaving this changes the place, so the pin comes off. Pick a result to move it instead.'
            : pinned
              ? `Pinned at ${value.lat!.toFixed(4)}, ${value.lng!.toFixed(4)}`
              : 'Found on a map, it gets a pin. Typed by hand, it still counts.'}
        </span>
      </div>

      {showing && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Matching places"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-raised py-1 shadow-lg"
        >
          {message && (
            <li role="presentation" className="px-3 py-2 text-sm text-ink-secondary">
              {message}
            </li>
          )}

          {places.map((result, position) => (
            <li key={`${result.lat},${result.lng}`} role="presentation">
              <div
                id={`${id}-option-${position}`}
                role="option"
                aria-selected={position === active}
                onMouseDown={() => choose(result)}
                onMouseEnter={() => setActive(position)}
                className={cn(
                  'cursor-pointer px-3 py-1.5',
                  position === active && 'bg-accent-soft',
                )}
              >
                <span className="block truncate text-sm text-ink">{result.label}</span>
                {result.address && (
                  <span className="block truncate text-2xs text-ink-muted">{result.address}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
