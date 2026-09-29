'use client';

import { useEffect } from 'react';
import { SITE_LANGUAGE } from '../lib/seo/metadata';

/**
 * The boundary of last resort — §4.13 WS-09, issue #263.
 *
 * <h2>This is the one failure state that is NOT inside the shell, and cannot be</h2>
 *
 * `global-error.tsx` catches a throw in the ROOT LAYOUT itself, which means the root layout
 * did not render — so it replaces the whole document and has to supply its own `<html>` and
 * `<body>`. There is no `SessionProvider` above it, so `SiteHeader` would throw on
 * `useSession` the moment it mounted; a shell rendered here would be a second uncaught error
 * inside the handler for the first, which is how a blank page happens.
 *
 * §4.13 asks for the failure states to keep the shell and `not-found.tsx` and `error.tsx` do.
 * This one cannot, and the honest version is a page that stands entirely on its own.
 *
 * <h2>So it depends on nothing</h2>
 *
 * No component import, no `@ideanest/ui`, no Tailwind class that a missing stylesheet would
 * make meaningless. **The colours are inline and they are literals**, which is the one place
 * in this repository that is true: `packages/ui/src/design-tokens.test.ts` fails a build for a
 * hex literal in a component, and the reason it exists — every colour comes from
 * `@ideanest/design-tokens` — assumes a stylesheet that has loaded. This file runs when the
 * document itself failed, so a `var(--surface-1)` here would resolve to nothing and render
 * black-on-black. The values are `--surface-1` and `--text-primary` exactly, and the test's
 * scope is `packages/ui`.
 *
 * `lang` comes from the same constant the root layout uses, so the two cannot drift.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('The root layout failed to render.', error);
  }, [error]);

  return (
    <html lang={SITE_LANGUAGE}>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          backgroundColor: '#0d0d0d',
          color: '#ffffff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}
      >
        <main>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.03em', margin: 0 }}>
            IdeyaNest could not load
          </h1>
          <p style={{ margin: '1rem auto 0', maxWidth: '46ch', lineHeight: 1.6, opacity: 0.64 }}>
            Something failed before the page could be built. Reloading is worth one attempt; if
            it keeps happening, the platform is having a problem rather than your browser.
          </p>
          {error.digest !== undefined && (
            <p style={{ margin: '1rem 0 0', fontSize: '0.875rem', opacity: 0.4 }}>
              Reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              height: '3rem',
              padding: '0 1.5rem',
              borderRadius: '9999px',
              border: 0,
              backgroundColor: '#ffffff',
              color: '#0a0a0a',
              font: 'inherit',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload the page
          </button>
        </main>
      </body>
    </html>
  );
}
