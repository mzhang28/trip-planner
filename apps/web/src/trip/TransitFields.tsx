import type { TransitDetails, TransitMethod, TripEvent } from '@trip/crdt';
import { ColorPicker, SegmentedControl, TextField } from '@trip/ui';
import { ArrowRight } from 'lucide-react';
import { EventKindIcon, TRANSIT_METHOD_LABEL } from './EventKind';

const METHOD_OPTIONS = (
  ['flight', 'train', 'bus', 'car', 'ferry', 'other'] as const
).map((value) => ({ value, label: TRANSIT_METHOD_LABEL[value] }));

/** Picks how a journey is made. A flight is one method among the rest now. */
export function TransitMethodPicker({
  method,
  onChange,
}: {
  method: TransitMethod;
  onChange: (method: TransitMethod) => void;
}) {
  return (
    <div data-testid="transit-method" className="rounded-xl border border-line bg-card px-3 py-2.5">
      <span className="mb-1 block text-xs font-medium text-ink-secondary">By</span>
      <SegmentedControl
        label="How this journey is made"
        options={METHOD_OPTIONS}
        value={method}
        onChange={onChange}
      />
    </div>
  );
}

/*
 * What the endpoints are called, per method. A flight has its own editor, so it
 * is never the one shown here; the rest read a station, a stop, or a port.
 */
const ENDPOINT: Record<TransitMethod, { point: string; from: string; to: string }> = {
  flight: { point: 'Airport', from: 'NRT', to: 'ITM' },
  train: { point: 'Station', from: 'Kyoto', to: 'Shin-Osaka' },
  bus: { point: 'Stop', from: 'Kyoto Stn', to: 'Osaka Stn' },
  car: { point: 'Address', from: 'Kyoto', to: 'Osaka' },
  ferry: { point: 'Port', from: 'Naoshima', to: 'Uno' },
  other: { point: 'From/to', from: 'Kyoto', to: 'Osaka' },
};

const OPERATOR_LABEL: Record<TransitMethod, string> = {
  flight: 'Airline',
  train: 'Train operator',
  bus: 'Bus line',
  car: 'Rental company',
  ferry: 'Ferry line',
  other: 'Operator',
};

interface TransitFieldsProps {
  event: TripEvent;
  cityColors?: Record<string, string>;
  onPatch: (patch: Partial<TripEvent>) => void;
  onSetCityColor: (city: string, color: string | undefined) => void;
}

/**
 * The common editor for a journey that is not a flight.
 *
 * The two ends, who runs it, and the details that fit the method. A flight has
 * its own richer editor with a timeline at each airport; everything else shares
 * this one, and the document holds whatever is set regardless of method.
 */
export function TransitFields({ event, cityColors, onPatch, onSetCityColor }: TransitFieldsProps) {
  const transit: TransitDetails = event.transit ?? { method: 'other' };
  const method = transit.method;

  function patchTransit(patch: Partial<TransitDetails>) {
    onPatch({ transit: { ...transit, ...patch } });
  }

  const names = ENDPOINT[method];
  const isTrain = method === 'train';
  const hasTerminal = method === 'ferry';

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-sunken/50">
      <div className="flex items-center gap-2 border-b border-line bg-card px-3 py-2.5">
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent-text">
          <EventKindIcon kind="transit" method={method} className="size-3.5" />
        </span>
        <div>
          <h3 className="text-sm font-medium text-ink">Route</h3>
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

      <div className="grid grid-cols-2 gap-2 border-t border-line bg-card px-3 py-3 sm:grid-cols-3">
        <TextField
          label={OPERATOR_LABEL[method]}
          key={`operator-${transit.operator ?? ''}`}
          defaultValue={transit.operator ?? ''}
          placeholder="JR West"
          onBlur={(e) => patchTransit({ operator: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Number"
          key={`number-${transit.number ?? ''}`}
          defaultValue={transit.number ?? ''}
          placeholder="Special Rapid"
          onBlur={(e) => patchTransit({ number: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label="Seat"
          key={`seat-${transit.seat ?? ''}`}
          defaultValue={transit.seat ?? ''}
          placeholder="12A"
          onBlur={(e) => patchTransit({ seat: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label={`${names.point} from`}
          key={`from-${transit.from ?? ''}`}
          defaultValue={transit.from ?? ''}
          placeholder={names.from}
          onBlur={(e) => patchTransit({ from: e.currentTarget.value.trim() || undefined })}
        />
        <TextField
          label={`${names.point} to`}
          key={`to-${transit.to ?? ''}`}
          defaultValue={transit.to ?? ''}
          placeholder={names.to}
          onBlur={(e) => patchTransit({ to: e.currentTarget.value.trim() || undefined })}
        />
        {isTrain && (
          <TextField
            label="Platform"
            key={`platform-${transit.platform ?? ''}`}
            defaultValue={transit.platform ?? ''}
            placeholder="4"
            onBlur={(e) => patchTransit({ platform: e.currentTarget.value.trim() || undefined })}
          />
        )}
        {isTrain && (
          <TextField
            label="Coach"
            key={`coach-${transit.coach ?? ''}`}
            defaultValue={transit.coach ?? ''}
            placeholder="6"
            onBlur={(e) => patchTransit({ coach: e.currentTarget.value.trim() || undefined })}
          />
        )}
        {hasTerminal && (
          <TextField
            label="Terminal"
            key={`terminal-${transit.terminal ?? ''}`}
            defaultValue={transit.terminal ?? ''}
            placeholder="1"
            onBlur={(e) => patchTransit({ terminal: e.currentTarget.value.trim() || undefined })}
          />
        )}
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
      <span className="text-2xs text-ink-muted">{TRANSIT_METHOD_LABEL[transit.method]}</span>
    </div>
  );
}
