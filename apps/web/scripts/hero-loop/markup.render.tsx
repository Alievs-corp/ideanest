import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
import { HeroSceneDrawing } from '../../src/components/home/HeroSceneDrawing';

/**
 * Not a test: Vitest is the repository's TSX runtime, and this is how `render.mjs` turns the
 * drawing into the HTML it captures. It runs only under `vitest.config.ts` beside it.
 */
it('writes the drawing markup', () => {
  const out = process.env.HERO_LOOP_MARKUP;
  if (out === undefined) throw new Error('HERO_LOOP_MARKUP is not set; run scripts/hero-loop/render.mjs');
  writeFileSync(out, renderToStaticMarkup(<HeroSceneDrawing className="top-0" />));
});
