import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every screen has a stable root id for the end-to-end suite — issue #165.
 *
 * The Maestro flows wait for `screen-<name>` to know where a link or a tap landed
 * (`components/screen-root.tsx`), and `e2e/generate-links-flow.mjs` reads the name out of the
 * route file. A route added without one fails here rather than in a nightly run on staging.
 */

const APP = join(__dirname, '..', 'app');
const MOBILE = join(__dirname, '..', '..');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Not screens: layouts, Expo Router's link hook, redirects, and the development-only kit. */
function isScreen(route: string, source: string): boolean {
  if (route.endsWith('_layout.tsx') || route === '+native-intent.tsx' || route === 'dev/kit.tsx') return false;
  return !/return \(?\s*<Redirect\b/.test(source);
}

describe('screen roots', () => {
  const screens = routeFiles(APP)
    .map((path) => ({ route: relative(APP, path).replace(/\\/g, '/'), source: readFileSync(path, 'utf8') }))
    .filter(({ route, source }) => isScreen(route, source))
    .map(({ route, source }) => ({
      route,
      name: /export default withScreenRoot\('([a-z0-9-]+)'/.exec(source)?.[1] ?? null,
    }));

  it('finds the screens', () => {
    expect(screens.length).toBeGreaterThan(50);
  });

  it('wraps every screen in withScreenRoot', () => {
    expect(screens.filter(({ name }) => name === null).map(({ route }) => route)).toEqual([]);
  });

  it('gives no two screens the same id', () => {
    const names = screens.map(({ name }) => name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it('keeps the committed links flow in step with the claimed-route table', () => {
    // Node strips the table's types itself, as `scripts/check-association.mjs` relies on.
    expect(() =>
      execFileSync(process.execPath, ['e2e/generate-links-flow.mjs', '--check'], { cwd: MOBILE, stdio: 'pipe' }),
    ).not.toThrow();
  });
});
