import { afterEach, describe, expect, it } from 'vitest';
import { CONSOLE_PATH, THEME_STORAGE_KEY, themeScriptSource } from './theme';

/** The inline script the root layout writes before anything paints — docs/ui-kit.md §11. */

function run(pathname: string): string | undefined {
  window.history.replaceState(null, '', pathname);
  new Function(themeScriptSource())();
  return document.documentElement.dataset.theme;
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.history.replaceState(null, '', '/');
});

describe('themeScriptSource', () => {
  it('leaves the dark default alone when nothing was chosen', () => {
    expect(run('/az/discover')).toBeUndefined();
  });

  it('applies a stored light choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(run('/az/discover')).toBe('light');
  });

  it('never makes the admin console light', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(run('/az/admin')).toBeUndefined();
    expect(run('/en/admin/users')).toBeUndefined();
  });

  it('matches the console and nothing that only starts like it', () => {
    expect(CONSOLE_PATH.test('/ru/admin')).toBe(true);
    expect(CONSOLE_PATH.test('/ru/admin/plans')).toBe(true);
    expect(CONSOLE_PATH.test('/ru/administrator')).toBe(false);
    expect(CONSOLE_PATH.test('/ru/u/admin')).toBe(false);
  });
});
