import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Storybook's react-vite builder picks this up, which is how the stories get
// Tailwind. The package ships TypeScript source rather than a build, so there
// is no library build step here.
export default defineConfig({
  /*
   * ES2022 for top-level await, which is how Automerge's WebAssembly loads.
   * The UI package reaches it through @trip/crdt: the custom field editor asks
   * whether a stored value still matches the type its field claims.
   */
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },

  plugins: [react(), tailwindcss(), wasm()],
  // No `server` block here. Storybook is the only thing that runs this config,
  // and it builds its own dev server rather than carrying this one over, so
  // host settings live in .storybook/main.ts where they take effect.
});
