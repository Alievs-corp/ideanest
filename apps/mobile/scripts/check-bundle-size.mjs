/**
 * The JavaScript bundle's budget — issue #165's "Performance budgets": fail at +10% over the
 * committed baseline.
 *
 * Usage: `node apps/mobile/scripts/check-bundle-size.mjs <expo export output dir>`
 *
 * <h2>What is measured</h2>
 *
 * The Hermes bytecode file `expo export --platform android` writes, `_expo/static/js/android/
 * <name>.hbc` — the same bytecode a release build embeds, compiled by the same `hermesc` from the
 * same Metro graph. Not the download size (assets, native code and store compression are App Store
 * Connect's and Play Console's numbers, recorded by hand in `README.md`), and not iOS: the
 * JavaScript is the same on both platforms, and `mobile-check.yml` exports Android only.
 *
 * <h2>Why a committed baseline and a ratio</h2>
 *
 * A growth of a few kilobytes is a feature; a growth of ten per cent is a dependency somebody did
 * not mean to ship, or a catalogue bundled twice. The baseline is a file in the repository, so
 * raising it is a reviewed change with its reason in the commit, which is the point: the check
 * does not stop the bundle growing, it stops it growing unnoticed. A bundle that has shrunk well
 * below the baseline passes and says so, so the next person can lower it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'bundle-size-baseline.json');

const exportDir = process.argv[2];
if (exportDir === undefined) {
  console.error('Usage: node apps/mobile/scripts/check-bundle-size.mjs <expo export output dir>');
  process.exit(2);
}

const bundleDir = join(exportDir, '_expo', 'static', 'js', 'android');
const bundles = readdirSync(bundleDir).filter((name) => name.endsWith('.hbc'));
if (bundles.length !== 1) {
  console.error(`Expected one Hermes bundle in ${bundleDir}, found ${bundles.length}: ${bundles.join(', ')}`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const bytes = statSync(join(bundleDir, bundles[0])).size;
const limit = Math.floor(baseline.bytes * (1 + baseline.tolerance));
const change = ((bytes - baseline.bytes) / baseline.bytes) * 100;

const kib = (value) => `${(value / 1024).toFixed(1)} KiB`;
const summary = `Hermes bundle ${kib(bytes)} against a baseline of ${kib(baseline.bytes)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%), limit ${kib(limit)}.`;

if (bytes > limit) {
  console.error(`${summary}\nOver budget. Find what grew, or raise "bytes" in ${BASELINE_FILE} with the reason in the commit.`);
  process.exit(1);
}
console.log(summary);
if (bytes < baseline.bytes * (1 - baseline.tolerance)) {
  console.log(`More than ${baseline.tolerance * 100}% under the baseline: lower "bytes" in ${BASELINE_FILE} so the budget keeps up.`);
}
