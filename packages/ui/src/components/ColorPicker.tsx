import { Check, Palette, X } from 'lucide-react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { cn } from '../lib/cn';
import {
  DEFAULT_COLOR_PALETTE,
  boldColor,
  mutedColor,
  readableTextColor,
} from '../lib/color';

export interface ColorPickerProps {
  value: string | undefined;
  onChange: (color: string | undefined) => void;
  label: string;
  isDisabled?: boolean;
}

/** A fixed, accessible palette for assigning a colour to a user-defined item. */
export function ColorPicker({ value, onChange, label, isDisabled }: ColorPickerProps) {
  const triggerBackground = mutedColor(value);
  const triggerBorder = boldColor(value);
  const triggerText = triggerBackground ? readableTextColor(triggerBackground) : undefined;

  return (
    <DialogTrigger>
      <Button
        aria-label={`${label}, ${value ? 'color selected' : 'no color'}`}
        isDisabled={isDisabled}
        style={
          triggerBackground
            ? {
                backgroundColor: triggerBackground,
                borderColor: triggerBorder,
                color: triggerText,
              }
            : undefined
        }
        className={cn(
          'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border',
          'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
          'data-disabled:cursor-not-allowed data-disabled:opacity-45',
          value ? 'border-transparent' : 'border-line-default bg-card text-ink-muted',
        )}
      >
        {value ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Palette aria-hidden="true" className="size-3.5" />
        )}
      </Button>

      <Popover
        placement="bottom start"
        className="rounded-lg border border-line-default bg-card p-2 shadow-lg outline-none"
      >
        <Dialog aria-label={label} className="outline-none">
          {({ close }) => (
            <div className="flex w-56 flex-col gap-2">
              <div className="grid grid-cols-8 gap-1.5">
                {DEFAULT_COLOR_PALETTE.map((color) => {
                  const text = readableTextColor(color.muted);
                  const selected = value?.toUpperCase() === color.bold;

                  return (
                    <Button
                      key={color.bold}
                      aria-label={color.name}
                      aria-pressed={selected}
                      onPress={() => {
                        onChange(color.bold);
                        close();
                      }}
                      style={{
                        backgroundColor: color.muted,
                        borderColor: color.bold,
                        color: text,
                      }}
                      className={cn(
                        'flex size-6 cursor-pointer items-center justify-center rounded-full border-2',
                        'data-hovered:scale-110 data-pressed:scale-95',
                        'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
                      )}
                    >
                      {selected && <Check aria-hidden="true" className="size-3.5" />}
                    </Button>
                  );
                })}
              </div>

              <Button
                onPress={() => {
                  onChange(undefined);
                  close();
                }}
                className={cn(
                  'flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs text-ink-secondary',
                  'data-hovered:bg-sunken data-pressed:bg-sunken',
                  'data-focus-visible:outline-focus data-focus-visible:outline-2 data-focus-visible:-outline-offset-1',
                )}
              >
                <X aria-hidden="true" className="size-3.5" />
                No color
              </Button>
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
