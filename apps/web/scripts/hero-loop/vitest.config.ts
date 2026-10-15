import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Runs `markup.render.tsx` only, in Node: `render.mjs` uses it to turn the drawing into HTML. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['scripts/hero-loop/markup.render.tsx'],
  },
});
