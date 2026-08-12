import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // The E2E harness gives each concurrent build its own generated public
  // assets instead of having them race in apps/web/public.
  publicDir: process.env.WEB_PUBLIC_DIR ?? 'public',
  // ES2022 for top-level await, which loading Automerge's WebAssembly needs.
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },

  plugins: [
    react(),
    tailwindcss(),
    /*
     * Automerge is compiled to WebAssembly, and its browser build loads the
     * module with an import Vite does not handle on its own.
     *
     * Only the resolver is needed. Initialising the module awaits at the top
     * level of a module, which is native from ES2022 — the build target below.
     * Downlevelling it instead produces code esbuild cannot express in ES2020
     * and the build fails outright.
     */
    wasm(),
    VitePWA({
      registerType: 'prompt',
      /*
       * `prompt` rather than `autoUpdate`. A trip being edited offline has
       * unsynced changes in memory, and reloading the page under someone
       * mid-edit to install a new version is how those get lost. The app asks
       * instead, and the person picks the moment.
       */
      manifest: {
        name: 'Trip Planner',
        short_name: 'Trips',
        description: 'Plan a trip together, with or without a signal.',
        start_url: '/',
        display: 'standalone',
        background_color: '#e7eaee',
        theme_color: '#12161c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Padded, so a platform that crops to a circle keeps the whole mark.
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /*
         * The WebAssembly has to be in here. Automerge is compiled to it, and
         * without it the app cannot read its own documents — it would install,
         * open offline, and show an empty trip. It is also several megabytes,
         * over Workbox's default ceiling, so the ceiling is raised to match.
         */
        globPatterns: ['**/*.{js,css,html,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Map tiles: keep what has been looked at so a day already viewed
            // still shows its map with no signal.
            urlPattern: /^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // The service worker runs in dev too, so the offline tests exercise the
        // same code path that ships instead of one that only exists in a build.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: apiProxy(),
  },

  /*
   * The end-to-end tests run against `vite preview`, not the dev server.
   *
   * The service worker is the reason. In dev, Vite serves unbundled modules
   * that the worker never precaches, so a reload with the network off fails
   * even though it works in the built app. Testing the build means the offline
   * behaviour under test is the one that ships.
   */
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: Number(process.env.WEB_PORT ?? 4173),
    strictPort: true,
    proxy: apiProxy(),
  },
});

function apiProxy() {
  // Both ports come from the environment so a test run can sit beside a dev
  // server on its own pair rather than fighting it for the port.
  const target = `http://localhost:${process.env.API_PORT ?? 8787}`;
  const forward = { target, changeOrigin: true, ws: true };

  return {
    '/api': forward,
    /*
     * The agent-facing paths are forwarded too. They are not under /api because
     * a client is handed the server's URL and looks for them where the specs
     * say they live -- so they have to be reachable at the root.
     */
    '/oauth': forward,
    '/mcp': forward,
    '/.well-known': forward,
  };
}
