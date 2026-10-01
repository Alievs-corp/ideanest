import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every route has a failure boundary of its own — issue #150.
 *
 * Expo Router wraps a route in its `ErrorBoundary` export and nothing else, so a screen that
 * forgets one hands its render error to the root — whose boundary is outside every provider and
 * can only offer a reload. That is a fault nobody sees until a screen throws on a phone, so it
 * is checked here, over the files, rather than left to review: the root layout exports the root
 * failure, and every other route file (the tab layout included) the shared route boundary.
 */

const APP = join(__dirname, '..', 'app');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** The name a file exports as `ErrorBoundary`, or null when it exports none. */
function boundaryOf(source: string): string | null {
  const reexport = /export\s*\{\s*(\w+)\s+as\s+ErrorBoundary\s*\}\s*from/.exec(source);
  if (reexport) return reexport[1]!;
  return /export\s+(function|const)\s+ErrorBoundary\b/.test(source) ? 'ErrorBoundary' : null;
}

describe('route failure boundaries', () => {
  const files = routeFiles(APP).map((path) => ({
    route: relative(APP, path).replace(/\\/g, '/'),
    boundary: boundaryOf(readFileSync(path, 'utf8')),
  }));

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('puts the root failure on the root layout, outside the providers', () => {
    expect(files.find(({ route }) => route === '_layout.tsx')?.boundary).toBe('RootFailure');
  });

  it('puts the shared route boundary on every other route', () => {
    const missing = files
      .filter(({ route }) => route !== '_layout.tsx')
      // Not a screen: Expo Router's link hook (#153), which renders nothing to fail.
      .filter(({ route }) => route !== '+native-intent.tsx')
      .filter(({ boundary }) => boundary !== 'RouteErrorBoundary')
      .map(({ route, boundary }) => `${route}: ${boundary ?? 'none'}`);
    expect(missing).toEqual([]);
  });
});
