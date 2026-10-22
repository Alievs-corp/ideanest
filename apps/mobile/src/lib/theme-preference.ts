import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';
import { deviceStore, type KeyValueStore } from './storage';

/**
 * The reader's colour theme on this phone — the web's light theme (docs/ui-kit.md §11), on the app.
 *
 * Dark is the default and is the absence of a stored choice. The choice is read once, when
 * `src/theme` is first imported, because every screen builds its styles from `colors` at import
 * time: switching therefore restarts the JavaScript, which takes about a second and lands the
 * reader back on the screen they switched from (`takeThemeReturn`). Rebuilding two hundred
 * stylesheets to swap them live would buy that second at the cost of every screen.
 */

export type ThemeName = 'dark' | 'light';

const THEME_KEY = 'theme';
const RETURN_KEY = 'theme.return';

export function readStoredTheme(store: KeyValueStore = deviceStore): ThemeName {
  try {
    return store.getString(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Stores `next` and restarts the app on it; `returnTo` is the path the restart opens again. */
export function chooseTheme(next: ThemeName, returnTo: string | null, store: KeyValueStore = deviceStore): void {
  if (next === 'light') store.set(THEME_KEY, 'light');
  else store.remove(THEME_KEY);
  if (returnTo !== null && returnTo !== '/') store.set(RETURN_KEY, returnTo);
  void restart();
}

/** The screen a theme switch left, once: the next launch for any other reason opens Home. */
export function takeThemeReturn(store: KeyValueStore = deviceStore): string | null {
  const path = store.getString(RETURN_KEY) ?? null;
  if (path !== null) store.remove(RETURN_KEY);
  return path;
}

async function restart(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // A development build has no updates runtime to reload through.
    DevSettings.reload();
  }
}
