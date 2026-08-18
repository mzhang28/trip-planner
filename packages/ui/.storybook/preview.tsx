import type { Decorator, Preview } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import './storybook.css';

function ThemePane({
  theme,
  label,
  children,
}: {
  theme: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div data-theme={theme} className="flex-1 bg-page p-6 text-ink">
      {label && (
        <div className="mb-4 text-2xs font-medium tracking-wide text-ink-muted uppercase">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * `Side by side` is the point of this decorator. Reviewing a component in one
 * theme and then switching means comparing what is on screen against a memory
 * of what was; showing both at once turns that into looking left and right.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as 'light' | 'dark' | 'both';

  if (theme === 'both') {
    return (
      <div className="flex min-h-[240px] flex-col sm:flex-row">
        <ThemePane theme="light" label="Light">
          <Story />
        </ThemePane>
        <ThemePane theme="dark" label="Dark">
          <Story />
        </ThemePane>
      </div>
    );
  }

  return (
    <ThemePane theme={theme}>
      <Story />
    </ThemePane>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'both', title: 'Side by side' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  parameters: {
    layout: 'fullscreen',
    // The decorator paints the surface token, so Storybook's own backgrounds
    // would only cover it with a colour that is not in the system.
    backgrounds: { disable: true },
    controls: { expanded: true },
    a11y: { test: 'error' },
  },
};

export default preview;
