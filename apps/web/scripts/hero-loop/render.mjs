/**
 * Renders the home hero's scene loops from `HeroSceneDrawing` — issues #490 and #491.
 *
 *   node scripts/hero-loop/render.mjs [web origin] [out folder]
 *
 * from `apps/web`, with the web app running (`next dev` or `next start`) at the origin, which
 * defaults to http://localhost:3000. The running app is only the stylesheet: its compiled CSS
 * holds the drawing's utility classes and the `hero-*` keyframes. The drawing itself comes from
 * `markup.render.tsx`.
 *
 * Each frame is the drawing with every animation paused and set to the frame's time, so the
 * capture is exact and one 6.4 s cycle loops with no seam. The legs swing on a 1.2 s period,
 * which 6.4 does not divide, so their time is scaled by 6.0 / 6.4 to fit five swings.
 *
 * Needs Chrome (`CHROME`, or the default install) and ffmpeg (`FFMPEG`, PATH, or
 * `pip install imageio-ffmpeg`). Writes the three cuts and their posters to the out folder, by
 * default the system temp folder; `upload.py` publishes them.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', '..');
const origin = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? join(tmpdir(), 'hero-loop');

const FPS = 30;
const FRAMES = 192;
const SCALE = 2;

/** The drawing is 600 × 540; each capture frames it on the surface its card or page has. */
const CAPTURES = [
  { name: 'wide', width: 600, height: 540, scale: 1, top: 0, surface: '--surface-1' },
  { name: 'phone', width: 360, height: 360, scale: 0.618, top: -14.4, surface: '--surface-2' },
];

const CUTS = [
  { name: 'desktop', from: 'wide', size: '1200:1080' },
  { name: 'tablet', from: 'wide', size: '960:864' },
  { name: 'phone', from: 'phone', size: '720:720' },
];

mkdirSync(out, { recursive: true });
const markup = drawingMarkup();
const chrome = await launchChrome();
try {
  const page = await chrome.page();
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: `${origin}/en/about` });
  await waitFor(page, `document.readyState === 'complete' && document.styleSheets.length > 0`);
  // Let the page hydrate and settle before drawing over it.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  for (const capture of CAPTURES) await captureFrames(page, capture);
} finally {
  chrome.close();
}
for (const cut of CUTS) encode(cut);
console.log(`\nWrote ${CUTS.map((cut) => `hero-scene-${cut.name}`).join(', ')} to ${out}`);
console.log('Publish: PROMO_S3_CREDENTIALS=<file> python scripts/hero-loop/upload.py <version> ' + out);

function drawingMarkup() {
  const file = join(out, 'drawing.html');
  execFileSync(
    process.execPath,
    [join(app, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', join(here, 'vitest.config.ts')],
    { cwd: app, stdio: 'inherit', env: { ...process.env, HERO_LOOP_MARKUP: file } },
  );
  return readFileSync(file, 'utf8');
}

async function captureFrames(page, { name, width, height, scale, top, surface }) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
  // On the root element, above everything, so the page's own React tree never touches it.
  await evaluate(
    page,
    `(() => {
      document.getElementById('hero-loop-stage')?.remove();
      const stage = document.createElement('div');
      stage.id = 'hero-loop-stage';
      stage.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:hidden;background:var(${surface})';
      stage.innerHTML = '<div style="position:absolute;left:50%;top:${top}px;width:600px;height:540px;' +
        'transform:translateX(-50%) scale(${scale});transform-origin:top center">' + ${JSON.stringify(markup)} + '</div>';
      document.documentElement.append(stage);
    })()`,
  );
  const folder = join(out, `frames-${name}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder);
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const ms = (frame / FPS) * 1000;
    await evaluate(
      page,
      `document.getElementById('hero-loop-stage').getAnimations({ subtree: true }).forEach((a) => {
        a.pause();
        a.currentTime = a.animationName === 'hero-swing' ? ${ms} * 6.0 / 6.4 : ${ms};
      })`,
    );
    const { data } = await page.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    writeFileSync(join(folder, `f${String(frame).padStart(3, '0')}.png`), Buffer.from(data, 'base64'));
  }
  console.log(`captured ${FRAMES} ${name} frames`);
}

function encode({ name, from, size }) {
  const ffmpeg = findFfmpeg();
  const input = ['-framerate', String(FPS), '-i', join(out, `frames-${from}`, 'f%03d.png')];
  const colour = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const target = join(out, `hero-scene-${name}`);
  execFileSync(ffmpeg, [
    '-v', 'error', '-y', ...input,
    '-vf', `scale=${size}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '23', '-tune', 'animation', '-profile:v', 'high',
    ...colour, '-movflags', '+faststart', '-an', `${target}.mp4`,
  ]);
  execFileSync(ffmpeg, [
    '-v', 'error', '-y', '-i', join(out, `frames-${from}`, 'f000.png'),
    '-vf', `scale=${size}:flags=lanczos`, '-c:v', 'libwebp', '-quality', '80', `${target}.webp`,
  ]);
  console.log(`encoded hero-scene-${name}`);
}

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    try {
      return execFileSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
    } catch {
      throw new Error('ffmpeg not found: set FFMPEG, put ffmpeg on PATH, or pip install imageio-ffmpeg');
    }
  }
}

async function launchChrome() {
  const binary =
    process.env.CHROME ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
    ].find((path) => existsSync(path));
  if (binary === undefined) throw new Error('Chrome not found: set CHROME to its executable');
  const profile = mkdtempSync(join(tmpdir(), 'hero-loop-chrome-'));
  const child = spawn(binary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], {
    stdio: 'ignore',
  });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let tries = 0; !existsSync(portFile) || readFileSync(portFile, 'utf8').trim() === ''; tries += 1) {
    if (tries > 100) throw new Error('Chrome did not open its debugging port');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  return {
    async page() {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find((entry) => entry.type === 'page');
      return connect(target.webSocketDebuggerUrl);
    },
    close() {
      child.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000);
    },
  };
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let next = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const waiting = message.id === undefined ? undefined : pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  return new Promise((resolve) => {
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          next += 1;
          const id = next;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((done, fail) => pending.set(id, { resolve: done, reject: fail }));
        },
      }),
    );
  });
}

async function evaluate(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function waitFor(page, condition) {
  for (let tries = 0; tries < 300; tries += 1) {
    if (await evaluate(page, condition)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${condition}`);
}
