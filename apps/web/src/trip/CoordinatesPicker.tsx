import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { Button, cn } from '@trip/ui';
import { ChevronDown, MapPin } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { parseCoordinatePair } from '../lib/coordinates';

export function CoordinatesPicker({
  lat,
  lng,
  onChange,
  onClear,
}: {
  lat?: number;
  lng?: number;
  onChange: (lat: number, lng: number) => void;
  onClear: () => void;
}) {
  const hasCoordinates = lat !== undefined && lng !== undefined;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange(next) {
      setOpen(next);
      if (next) {
        setDraft(hasCoordinates ? `${lat}, ${lng}` : '');
        setError(null);
      }
    },
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // Open on mousedown so the adjacent place input can commit its text first.
  const click = useClick(context, { event: 'mousedown' });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  function save() {
    const result = parseCoordinatePair(draft);
    if (!result.coordinates) {
      setError(result.error);
      return;
    }

    onChange(result.coordinates.lat, result.coordinates.lng);
    setOpen(false);
  }

  const exact = hasCoordinates ? `${lat}, ${lng}` : undefined;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={hasCoordinates ? `Coordinates: ${exact}` : 'Add coordinates'}
        title={hasCoordinates ? `Coordinates selected: ${exact}` : 'Paste latitude and longitude'}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line bg-sunken px-1.5',
          'text-2xs text-ink-secondary hover:border-line-strong hover:bg-raised',
          'focus-visible:outline-2 focus-visible:outline-focus',
        )}
        {...getReferenceProps()}
      >
        <MapPin aria-hidden="true" className="size-3" />
        <span>{hasCoordinates ? 'Pinned' : 'Add coordinates'}</span>
        <ChevronDown aria-hidden="true" className="size-3" />
      </button>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} initialFocus={inputRef} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              aria-label="Coordinates"
              className="z-50 w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-line bg-raised p-3 shadow-lg"
              {...getFloatingProps()}
            >
              <h3 className="text-sm font-medium text-ink">Coordinates</h3>
              <p className="mt-1 text-2xs text-ink-muted">
                Paste latitude, longitude from Google Maps or type the pair.
              </p>

              <label className="mt-3 block text-xs font-medium text-ink-secondary">
                Latitude, longitude
                <input
                  ref={inputRef}
                  value={draft}
                  inputMode="decimal"
                  placeholder="34.89155, 135.80449"
                  aria-invalid={error !== null}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => {
                    setDraft(event.currentTarget.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      save();
                    }
                  }}
                  className={cn(
                    'mt-1 h-9 w-full rounded-md border bg-card px-2.5 font-mono text-sm text-ink',
                    'placeholder:text-ink-placeholder focus:outline-2 focus:-outline-offset-1 focus:outline-focus',
                    error ? 'border-danger' : 'border-line-input focus:border-accent',
                  )}
                />
              </label>

              {error && (
                <p id={errorId} role="alert" className="mt-1.5 text-2xs text-danger">
                  {error}
                </p>
              )}

              <div className="mt-3 flex items-center justify-end gap-2">
                {hasCoordinates && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mr-auto text-danger"
                    onPress={() => {
                      onClear();
                      setOpen(false);
                    }}
                  >
                    Remove pin
                  </Button>
                )}
                <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" onPress={save}>
                  Save coordinates
                </Button>
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
