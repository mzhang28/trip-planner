import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Storybook's react-vite builder picks this up, which is how the stories get
// Tailwind. The package ships TypeScript source rather than a build, so there
// is no library build step here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on every interface, and accept ephemeral hostnames — ones that
    // differ from session to session, such as a tunnel or preview host handed
    // out fresh each time. Vite otherwise rejects any Host header not named in
    // advance, which is impossible when the name is not known in advance.
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
