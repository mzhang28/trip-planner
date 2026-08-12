import type { TransitDetails, TransitMode, TripEvent } from '@trip/crdt';
import { ColorPicker, SegmentedControl, TextField } from '@trip/ui';
import { ArrowRight, BusFront } from 'lucide-react';

const TRANSIT_MODES = [
  { value: 'transit', label: 'Train / bus' },
  { value: 'drive', label: 'Drive' },
  { value: 'walk', label: 'Walk' },
  { value: 'fly', label: 'Fly' },
] as const;

const MODE_LABEL: Record<TransitMode, string> = {
  transit: 'Train / bus',
  drive: 'Drive',
  walk: 'Walk',
  fly: 'Fly',
};

interface TransitFieldsProps {
  event: TripEvent;
  cityColors?: Record<string, string>;
  onPatch: (patch: Partial<TripEvent>) => void;
  onSetCityColor: (city: string, color: string | undefined) => void;
}

/** The two ends of a journey, distinct from an event's optional “getting here” leg. */
export function TransitFields({
  event,
  cityColors,
  onPatch,
  onSetCityColor,
}: TransitFieldsProps) {
  const transit = event.transit ?? { mode: 'transit' };

  function patchTransit(patch: Partial<TransitDetails>) {
    onPatch({ transit: { ...transit, ...patch } });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-sunken/50">
      <div className="flex items-center gap-2 border-b border-line bg-card px-3 py-2.5">
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent-text">
          <BusFront aria-hidden="true" className="size-3.5" />
        </span>
        <div>
          <h3 className="text-sm font-medium text-ink">Transit route</h3>
          <p className="text-2xs text-ink-muted">Where this journey starts and ends</p>
        </div>
      </div>

      <div className="grid items-start gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)]">
        <RouteCityField
          label="Starting city"
          value={transit.fromCity}
          color={transit.fromCity ? cityColors?.[transit.fromCity] : undefined}
          placeholder="Kyoto"
          onChange={(fromCity) => patchTransit({ fromCity })}
          onSetColor={(color) => transit.fromCity && onSetCityColor(transit.fromCity, color)}
        />

        <ArrowRight aria-hidden="true" className="mt-7 hidden size-4 text-ink-muted sm:block" />

        <RouteCityField
          label="Ending city"
          value={transit.toCity}
          color={transit.toCity ? cityColors?.[transit.toCity] : undefined}
          placeholder="Osaka"
          onChange={(toCity) => patchTransit({ toCity })}
          onSetColor={(color) => transit.toCity && onSetCityColor(transit.toCity, color)}
        />
      </div>

      <div className="border-t border-line bg-card px-3 py-3">
        <span className="mb-1 block text-xs font-medium text-ink-secondary">By</span>
        <SegmentedControl
          label="Transit mode"
          options={TRANSIT_MODES}
          value={transit.mode}
          onChange={(mode) => patchTransit({ mode })}
        />
      </div>
    </section>
  );
}

export function RouteCityField({
  label,
  value,
  color,
  placeholder,
  onChange,
  onSetColor,
}: {
  label: string;
  value: string | undefined;
  color: string | undefined;
  placeholder: string;
  onChange: (city: string | undefined) => void;
  onSetColor: (color: string | undefined) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-card p-3 shadow-sm">
      <TextField
        key={value ?? ''}
        label={label}
        className="min-w-0 flex-1"
        defaultValue={value ?? ''}
        placeholder={placeholder}
        onBlur={(event) => onChange(event.currentTarget.value.trim() || undefined)}
      />
      {value && (
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span className="text-xs font-medium text-ink-secondary">Color</span>
          <ColorPicker value={color} label={`Color for ${value}`} onChange={onSetColor} />
        </div>
      )}
    </div>
  );
}

export function TransitSummary({ event }: { event: TripEvent }) {
  const transit = event.transit;
  if (!transit?.fromCity && !transit?.toCity) return null;

  return (
    <div
      data-testid="transit-summary"
      className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs"
    >
      <span className="font-medium text-ink">{transit.fromCity ?? 'Somewhere'}</span>
      <span aria-hidden="true" className="flex-1 border-t border-dashed border-line-strong" />
      <span className="sr-only">to</span>
      <span className="font-medium text-ink">{transit.toCity ?? 'Somewhere'}</span>
      <span className="text-2xs text-ink-muted">{MODE_LABEL[transit.mode]}</span>
    </div>
  );
}
