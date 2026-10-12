import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [lang = 'az', ...list] = process.argv.slice(2);
const frames = list.length ? list.map(Number) : [140, 300, 540, 790, 1000, 1180, 1290, 1799];
const out = join(root, 'out', 'stills');
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts') });
const id = `SparkToNest-9x16-${lang}`;
const composition = await selectComposition({ serveUrl, id, inputProps: { lang, sound: false } });

for (const frame of frames) {
  const output = join(out, `${lang}-${String(frame).padStart(4, '0')}.png`);
  await renderStill({ composition, serveUrl, frame, output, inputProps: { lang, sound: false }, scale: 0.5 });
  console.log(output);
}
