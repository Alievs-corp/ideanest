#!/usr/bin/env node
/**
 * Renders every icon, splash and store image from the brand mark and the colour tokens — #165.
 *
 * Usage, from `apps/mobile`:
 *   node scripts/generate-assets.mjs           writes the PNGs (commit them)
 *   node scripts/generate-assets.mjs --check   fails if a committed PNG differs from a fresh render
 *
 * The inputs are the web's: the mark is `apps/web/src/app/icon.svg`, the file the site serves as
 * its favicon, and every colour is a token from `@ideanest/design-tokens`. Nothing is drawn by
 * hand, so a new mark or a retuned token is one command away from every size the stores ask for,
 * and CI (`mobile-check.yml`) refuses a commit whose PNGs and inputs disagree.
 *
 * The renderer is `sharp` at an exact version (librsvg and cairo come inside its prebuilt
 * binary), and the mark is pure vector — no text, so no font that a machine could substitute.
 * The check still compares decoded pixels rather than file bytes: the PNG encoder's deflate
 * output may legitimately differ between CPUs, and the pixels are what a store shows.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { colors } from '@ideanest/design-tokens';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const repoRoot = join(mobileRoot, '..', '..');
const MARK_FILE = join(repoRoot, 'apps/web/src/app/icon.svg');

/**
 * The largest difference one colour channel of one pixel may show between a committed PNG and a
 * fresh render. Not zero, so that an antialiased edge rounded one step differently by another
 * build of the rasteriser does not fail CI; far below anything a person could see, so a changed
 * colour, size or position always does.
 */
const CHANNEL_TOLERANCE = 2;

/** The mark's own drawing area, from the brand file. */
function readMark() {
  const source = readFileSync(MARK_FILE, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1];
  if (viewBox === undefined) throw new Error(`${MARK_FILE} has no viewBox`);
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  if (!(width > 0 && height > 0)) throw new Error(`${MARK_FILE} has an unusable viewBox: ${viewBox}`);

  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(source)?.[1];
  if (body === undefined) throw new Error(`${MARK_FILE} has no <svg> body`);

  // The brand file paints the mark in lime. Every fill must be that one token, so a recoloured
  // export is a loud failure here rather than a quiet second green in the stores.
  const fills = new Set([...body.matchAll(/fill="([^"]+)"/g)].map((match) => match[1].toUpperCase()));
  if (fills.size !== 1 || !fills.has(colors.lime500.toUpperCase())) {
    throw new Error(
      `${MARK_FILE} should paint the mark in colors.lime500 only; found ${[...fills].join(', ')}`,
    );
  }
  return { viewBox, width, height, body };
}

const mark = readMark();

/**
 * One image: a canvas of `width` × `height`, an optional background, and the mark `markHeight`
 * pixels tall, centred, in `fill`.
 */
function svgFor({ width, height, background, fill, markHeight }) {
  const markWidth = (markHeight * mark.width) / mark.height;
  const x = (width - markWidth) / 2;
  const y = (height - markHeight) / 2;
  const body = mark.body.replace(/fill="[^"]+"/g, `fill="${fill}"`);
  const backdrop =
    background === undefined ? '' : `<rect width="${width}" height="${height}" fill="${background}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    backdrop +
    `<svg x="${x}" y="${y}" width="${markWidth}" height="${markHeight}" viewBox="${mark.viewBox}">${body}</svg>` +
    `</svg>`
  );
}

/**
 * Every generated file. `opaque` drops the alpha channel: Apple rejects an App Store icon with
 * one, and Play wants the feature graphic as a 24-bit PNG.
 */
const ASSETS = [
  {
    // The App Store icon and the iOS light appearance; Android's legacy icon below API 26.
    file: 'assets/icon.png',
    width: 1024,
    height: 1024,
    background: colors.surface1,
    fill: colors.lime500,
    markHeight: 676,
    opaque: true,
  },
  {
    // iOS 18 dark appearance: the mark alone, the system supplies the dark backdrop.
    file: 'assets/icon-dark.png',
    width: 1024,
    height: 1024,
    fill: colors.lime500,
    markHeight: 676,
  },
  {
    // iOS 18 tinted appearance: a grayscale icon whose luminance the system tints.
    file: 'assets/icon-tinted.png',
    width: 1024,
    height: 1024,
    background: colors.surface1,
    fill: colors.textPrimary,
    markHeight: 676,
    opaque: true,
  },
  {
    // Android adaptive foreground. The launcher masks the outer third, so the mark stays inside
    // the 66% safe circle; the background is `colors.surface1` in app.config.ts.
    file: 'assets/adaptive-icon.png',
    width: 1024,
    height: 1024,
    fill: colors.lime500,
    markHeight: 516,
  },
  {
    // Android 13+ themed icon: only the alpha is read, the system picks the colour.
    file: 'assets/adaptive-icon-monochrome.png',
    width: 1024,
    height: 1024,
    fill: colors.textPrimary,
    markHeight: 516,
  },
  {
    // Android status-bar icon: white on transparent, as the platform requires; tinted with
    // `colors.lime500` by the expo-notifications plugin. 96 px is the xxxhdpi size.
    file: 'assets/notification-icon.png',
    width: 96,
    height: 96,
    fill: colors.textPrimary,
    markHeight: 80,
  },
  {
    // The splash mark, drawn `imageWidth` wide over `colors.surface1`.
    file: 'assets/splash-icon.png',
    width: 1024,
    height: 1024,
    fill: colors.lime500,
    markHeight: 616,
  },
  {
    // Google Play's feature graphic, 1024 × 500.
    file: 'store/feature-graphic.png',
    width: 1024,
    height: 500,
    background: colors.surface1,
    fill: colors.lime500,
    markHeight: 300,
    opaque: true,
  },
];

function render(asset) {
  let image = sharp(Buffer.from(svgFor(asset)));
  if (asset.opaque) image = image.flatten({ background: asset.background });
  return image.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

async function pixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

/** Why `committed` is not the image `fresh` describes, or `null` when it is. */
async function difference(committed, fresh, asset) {
  const meta = await sharp(committed).metadata();
  if (meta.width !== asset.width || meta.height !== asset.height) {
    return `is ${meta.width}×${meta.height}, expected ${asset.width}×${asset.height}`;
  }
  if (Boolean(meta.hasAlpha) === Boolean(asset.opaque)) {
    return asset.opaque ? 'has an alpha channel, expected none' : 'has no alpha channel';
  }
  const a = await pixels(committed);
  const b = await pixels(fresh);
  let worst = 0;
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const delta = Math.abs(a.data[i] - b.data[i]);
    if (delta > 0) differing += 1;
    if (delta > worst) worst = delta;
  }
  if (worst > CHANNEL_TOLERANCE) {
    return `differs from a fresh render (${differing} channel values, by up to ${worst})`;
  }
  return null;
}

async function main() {
  const check = process.argv.includes('--check');
  const failures = [];

  for (const asset of ASSETS) {
    const target = join(mobileRoot, asset.file);
    const fresh = await render(asset);
    if (check) {
      if (!existsSync(target)) {
        failures.push(`${asset.file} is missing`);
        continue;
      }
      const why = await difference(readFileSync(target), fresh, asset);
      if (why !== null) failures.push(`${asset.file} ${why}`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, fresh);
      console.log(`wrote ${relative(repoRoot, target)}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      'The committed images are not what scripts/generate-assets.mjs renders from the brand mark and the tokens:\n' +
        failures.map((failure) => `  - ${failure}`).join('\n') +
        '\nRun `node scripts/generate-assets.mjs` in apps/mobile and commit the result.',
    );
    process.exit(1);
  }
  if (check) console.log(`${ASSETS.length} generated images match their inputs.`);
}

await main();
