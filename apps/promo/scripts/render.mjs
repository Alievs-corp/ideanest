import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('@remotion/cli/package.json')), 'remotion-cli.js');
const languages = process.argv.slice(2).length ? process.argv.slice(2) : ['az'];
const out = join(root, 'out');
const soundtrack = join(root, 'public', 'media', 'audio', 'soundtrack.wav');

function remotion(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(soundtrack)) {
  console.error('public/media is missing: run `pnpm prepare-media` first');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

for (const lang of languages) {
  const id = `SparkToNest-9x16-${lang}`;
  const name = `spark-to-nest-9x16-${lang}`;
  const master = join(out, `${name}.master.mp4`);
  const delivery = join(out, `${name}.mp4`);
  remotion('render', 'src/index.ts', id, master, '--log=error', '--overwrite');
  remotion(
    'ffmpeg', '-v', 'error', '-y', '-i', master, '-i', soundtrack, '-map', '0:v', '-map', '1:a',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-b:v', '16M', '-maxrate', '20M', '-bufsize', '32M', '-r', '60',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', '-shortest', delivery,
  );
  remotion('still', 'src/index.ts', id, join(out, `${name}.png`), '--frame=1799', '--log=error', '--overwrite');
  console.log(`master   ${master}\ndelivery ${delivery}`);
}
