'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@ideanest/ui';
import { applyTheme, storeTheme, storedTheme, THEME_STORAGE_KEY, type Theme } from '../../lib/theme/theme';
import type { ShellCopy } from '../../lib/i18n/shell-copy';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Follows `<html data-theme>`, which the inline script set before paint, and a choice made in
 * another tab, which arrives as a `storage` event.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) applyTheme(storedTheme());
  };
  window.addEventListener('storage', onStorage);

  return () => {
    observer.disconnect();
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * The theme control — docs/ui-kit.md §11. A round button beside the language globe that
 * switches between the dark default and the light theme and remembers the choice on this
 * device.
 *
 * Both glyphs are rendered and CSS picks one from `<html data-theme>`, so the button shows the
 * right icon in the server's markup too, before hydration has read the attribute.
 */
export function ThemeToggle({
  copy,
  className,
}: {
  readonly copy: ShellCopy['theme'];
  readonly className?: string;
}) {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => 'dark');
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  const label = next === 'light' ? copy.toLight : copy.toDark;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        storeTheme(next);
        applyTheme(next);
      }}
      className={cn(
        'inline-grid size-10 place-items-center rounded-full bg-surface-3 text-fg transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        className,
      )}
    >
      <Sun aria-hidden="true" className="size-[18px] in-data-[theme=light]:hidden" />
      <Moon aria-hidden="true" className="hidden size-[18px] in-data-[theme=light]:block" />
    </button>
  );
}
