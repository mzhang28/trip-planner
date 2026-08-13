import type { Meta, StoryObj } from '@storybook/react-vite';
import type { EventKind, TransitMethod } from '@trip/crdt';
import { Example } from '../stories/harness';
import { EVENT_KIND_LABEL, EventKindIcon, TRANSIT_METHOD_LABEL } from './EventKind';

/**
 * The mark that says what kind of thing an event is.
 *
 * It sits before the name on every card in the app, at 14px, next to text —
 * which is the size and the company it has to hold its own in. A transit event
 * shows its method instead of a generic one, so a flight and a ferry are told
 * apart without reading either.
 */
const meta = {
  title: 'Foundations/Event kinds',
} satisfies Meta;

export default meta;
type Story = StoryObj;

const KINDS: EventKind[] = ['activity', 'lodging', 'transit', 'note'];
const METHODS: TransitMethod[] = ['flight', 'train', 'bus', 'car', 'ferry', 'other'];

export const Icons: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Example title="Kinds">
        <div className="flex flex-wrap gap-6">
          {KINDS.map((kind) => (
            <div key={kind} className="flex w-24 flex-col items-center gap-1.5">
              <EventKindIcon kind={kind} className="size-5 text-ink" />
              <span className="text-2xs text-ink-muted">{EVENT_KIND_LABEL[kind]}</span>
            </div>
          ))}
        </div>
      </Example>

      <Example title="Transit methods">
        <div className="flex flex-wrap gap-6">
          {METHODS.map((method) => (
            <div key={method} className="flex w-24 flex-col items-center gap-1.5">
              <EventKindIcon kind="transit" method={method} className="size-5 text-ink" />
              <span className="text-2xs text-ink-muted">{TRANSIT_METHOD_LABEL[method]}</span>
            </div>
          ))}
        </div>
      </Example>
    </div>
  ),
};

/** At the size they are actually used, beside the text they sit beside. */
export const InPlace: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-2">
      {[
        { kind: 'transit' as const, method: 'flight' as const, name: 'SFO → NRT' },
        { kind: 'transit' as const, method: 'train' as const, name: 'GO TO KYOTO' },
        { kind: 'lodging' as const, name: 'Momijiya Annex' },
        { kind: 'activity' as const, name: 'Arashiyama bamboo forest' },
        { kind: 'note' as const, name: 'Cash, not cards' },
      ].map((row) => (
        <div key={row.name} className="flex items-center gap-1.5">
          <EventKindIcon kind={row.kind} method={row.method} className="size-3.5 text-ink-muted" />
          <span className="text-sm font-medium text-ink">{row.name}</span>
        </div>
      ))}
    </div>
  ),
};
