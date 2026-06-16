// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  // Allow astro:assets to optimize the catalog's remote images at build time
  // (resize + WebP). Allowlist the host the seed catalog's images are served from.
  image: {
    remotePatterns: [{ protocol: 'https', hostname: 'wolt-menu-images-cdn.wolt.com' }]
  },

  vite: {
    plugins: [tailwindcss()]
  }
});