/**
 * The reader's colour theme — docs/ui-kit.md §11.
 *
 * Dark is the product's default and needs nothing: it is what the token file declares on
 * `:root`. Light is a choice a reader makes with the header's control, remembered in
 * `localStorage` on this device and applied as `data-theme="light"` on `<html>`.
 *
 * The root layout is statically generated, so the server cannot know the choice. An inline
 * script at the top of `<body>` applies it before the first paint instead; anything later
 * paints the page dark and then flips it, which reads as a flash on every navigation.
 *
 * The admin console is dark whatever the reader chose: the script leaves its routes alone and
 * `ConsoleTheme` holds `<html>` dark for as long as the console is mounted.
 */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'ideanest-theme';

/** `/az/admin`, `/en/admin/users` — every route `app/[locale]/admin` renders. */
export const CONSOLE_PATH = /^\/[a-z]{2}\/admin(?:\/|$)/;

export function storedTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function storeTheme(theme: Theme): void {
  try {
    if (theme === 'light') window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage refused (private mode, quota): the choice lasts for this page only.
  }
}

/** Puts `theme` on `<html>`. Dark is the absence of the attribute's light value. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
}

/** The inline script the root layout writes into `<body>`, before anything paints. */
export function themeScriptSource(): string {
  return (
    '(function(){try{' +
    `if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==='light'&&` +
    `!${CONSOLE_PATH.toString()}.test(location.pathname))` +
    "document.documentElement.dataset.theme='light'" +
    '}catch(e){}})();'
  );
}
