import type { ReactNode } from 'react';
import { IntlProvider, useTranslations } from 'use-intl';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import type { Locale } from '@ideanest/messages';
import { useLocale } from './locale';

/**
 * Every word on every screen comes through here — issue #150.
 *
 * `use-intl` is the framework-agnostic core `next-intl` is built on, at the version the web
 * resolves, so a key and its arguments mean the same on both platforms (`t()`, `t.rich()`,
 * namespaces, ICU plurals). The catalogues are the web's own, from `@ideanest/messages`;
 * only the `mobile` namespace is the app's.
 *
 * All four are bundled (Metro cannot load a JSON lazily) and the active one is chosen by
 * `lib/locale.ts`, so changing the language re-renders the tree with no restart. Whether a
 * build step should strip the web-only `admin` namespace is the release-readiness issue's.
 */
const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr } as Record<Locale, typeof en>;

/** A missing key renders its own name rather than taking a screen down, as on the web. */
function fallback({ key, namespace }: { key: string; namespace?: string }): string {
  return namespace === undefined ? key : `${namespace}.${key}`;
}

export function AppIntlProvider({ children }: { readonly children: ReactNode }) {
  const locale = useLocale();
  return (
    <IntlProvider
      locale={locale}
      messages={CATALOGUES[locale]}
      getMessageFallback={fallback}
      onError={() => {}}
    >
      {children}
    </IntlProvider>
  );
}

/** The translator for a namespace, or for the whole catalogue with no argument. */
export const useT = useTranslations;
