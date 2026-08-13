import type { StorybookConfig } from '@storybook/react-vite';
import wasm from 'vite-plugin-wasm';

const config: StorybookConfig = {
  /*
   * The app's own components are catalogued here too.
   *
   * The design system is only half of what there is to look at: an event card,
   * a week of columns, and a transit summary are where most of the styling
   * decisions actually land, and they live in the app because they know about
   * trips. Rather than hollowing them out into @trip/ui for the sake of a
   * catalogue, the catalogue reaches into the app. Their stories stand the
   * components up against a fixed trip and a stubbed server, so they render
   * the same way every time without one running.
   */
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx)',
    '../../../apps/web/src/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  viteFinal(viteConfig) {
    /*
     * Reachable from other machines under whatever name they use to get here,
     * including this box's own name of `ephemeral`. Storybook builds its own
     * dev server rather than carrying over the `server` block from
     * vite.config.ts, which is why this is set here.
     */
    viteConfig.server = {
      ...viteConfig.server,
      host: '0.0.0.0',
      allowedHosts: true,
    };

    /*
     * Automerge is WebAssembly, and the app's fixtures build a real document
     * rather than a hand-written object so the stories exercise the same code
     * the app does. Loading it needs the resolver, and awaiting it needs
     * top-level await — hence the ES2022 target, matching apps/web.
     */
    viteConfig.plugins = [...(viteConfig.plugins ?? []), wasm()];
    viteConfig.build = { ...viteConfig.build, target: 'es2022' };
    viteConfig.esbuild = { ...viteConfig.esbuild, target: 'es2022' };
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      esbuildOptions: { ...viteConfig.optimizeDeps?.esbuildOptions, target: 'es2022' },
    };

    return viteConfig;
  },
};

export default config;
