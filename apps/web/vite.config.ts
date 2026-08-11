import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Map tiles: keep what has been looked at so a day already viewed
            // still shows its map with no signal.
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/,
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
    proxy: {
      '/api': {
        // Both ports come from the environment so the test run can sit beside a
        // dev server on its own pair rather than fighting it for the port.
        target: `http://localhost:${process.env.API_PORT ?? 8787}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
