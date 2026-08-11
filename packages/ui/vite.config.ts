import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Storybook's react-vite builder picks this up, which is how the stories get
// Tailwind. The package ships TypeScript source rather than a build, so there
// is no library build step here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // No `server` block here. Storybook is the only thing that runs this config,
  // and it builds its own dev server rather than carrying this one over, so
  // host settings live in .storybook/main.ts where they take effect.
});
