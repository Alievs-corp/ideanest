'use client';

import { useEffect } from 'react';
import { applyTheme, storedTheme } from '../../lib/theme/theme';

/**
 * Holds the admin console dark — docs/ui-kit.md §11.
 *
 * The light theme is for the public site and the reader's own pages; the console is a working
 * tool drawn for the dark set only. A full load of a console route is never made light, because
 * the inline theme script skips `/admin`. This covers arriving from the site in the same tab:
 * `<html>` goes dark while the console is mounted, so overlays portalled to `<body>` are dark
 * too, and the reader's choice comes back when they leave.
 */
export function ConsoleTheme() {
  useEffect(() => {
    applyTheme('dark');
    return () => applyTheme(storedTheme());
  }, []);

  return null;
}
