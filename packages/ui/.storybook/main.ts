import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  /*
   * Reachable from other machines under whatever name they use to get here,
   * including this box's own name of `ephemeral`. Storybook builds its own dev
   * server rather than carrying over the `server` block from vite.config.ts,
   * which is why this is set here.
   */
  viteFinal(viteConfig) {
    viteConfig.server = {
      ...viteConfig.server,
      host: '0.0.0.0',
      allowedHosts: true,
    };
    return viteConfig;
  },
};

export default config;
