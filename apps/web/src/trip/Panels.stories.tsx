import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Example } from '../stories/harness';
import { AuditPanel } from './AuditPanel';
import { SharePanel } from './SharePanel';
import { SyncBadge } from './SyncBadge';
import { UndoBar } from './UndoBar';
import type { TripState } from './TripStore';

/**
 * The panels and strips that talk about the trip rather than about an event:
 * who can reach it, what an agent did to it, whether a change is safe, and
 * how to take one back.
 *
 * These are the parts that need a server, so they are drawn here against a
 * stubbed one — see `apps/web/src/stories/apiStub.ts`. Sharing shows three
 * links and three people; the log shows what an agent did four minutes ago.
 */
const meta = {
  title: 'Panels/Trip',
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Who can reach the trip, what they may do, and how to stop them. */
export const Sharing: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Draws its own backdrop: sharing is a dialog over the trip, not a panel beside it.',
      },
    },
  },
  render: () => <SharePanel tripId="t_japan" onClose={() => {}} />,
};

/**
 * What was done to the trip by something other than a person in the app.
 *
 * Filtered to agents by default: those are the changes nobody watched happen,
 * which is what makes an undo button worth having.
 */
export const AgentLog: Story = {
  render: () => (
    <div className="max-w-2xl">
      <AuditPanel tripId="t_japan" onUndone={() => {}} />
    </div>
  ),
};

/** Every state of the badge that says whether an edit is safe. */
export const Saving: Story = {
  render: () => {
    const phases: Array<[TripState['phase'], string]> = [
      ['idle', 'Everything is on the server'],
      ['syncing', 'A change is on its way'],
      ['pending', 'No signal — the change is on this device'],
      ['resync-required', 'Starting the conversation again'],
    ];

    return (
      <div className="flex flex-col gap-4">
        {phases.map(([phase, note]) => (
          <div key={phase} className="flex items-center gap-3">
            <SyncBadge state={{ phase } as TripState} />
            <span className="text-sm text-ink-secondary">{note}</span>
          </div>
        ))}
      </div>
    );
  },
};

/**
 * The offer to put something back.
 *
 * It appears after anything destructive and takes itself away after ten
 * seconds — long enough to notice a mistake, short enough not to become part
 * of the furniture.
 */
export const Undo: Story = {
  render: function Undo() {
    const [shown, setShown] = useState(true);

    return (
      <div className="flex flex-col gap-8">
        <Example title="After a delete">
          {shown ? (
            <UndoBar
              message="Deleted Fushimi Inari Taisha"
              onUndo={() => setShown(false)}
              onDismiss={() => setShown(false)}
            />
          ) : (
            <button
              type="button"
              className="self-start text-sm text-accent-text underline"
              onClick={() => setShown(true)}
            >
              Show it again
            </button>
          )}
        </Example>

        <Example title="After taking a field off an event">
          <UndoBar message="Removed Confirmation code" onUndo={() => {}} onDismiss={() => {}} />
        </Example>

        <Example title="After a drag in the week">
          <UndoBar message="Moved Chiikawa park" onUndo={() => {}} onDismiss={() => {}} />
        </Example>
      </div>
    );
  },
};
