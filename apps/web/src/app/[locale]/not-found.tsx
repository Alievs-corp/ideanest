import type { Metadata } from 'next';
import { FailureAction, FailureState } from '../../components/shell/FailureState';
import { MinimalShell } from '../../components/shell/MinimalShell';
import { privatePageMetadata } from '../../lib/seo/metadata';
import { failureCopy } from '../../lib/i18n/shell-copy.server';
import { shellCopy } from '../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

/**
 * The 404 for a request that matched no route at all — §4.13 WS-09, issue #263.
 *
 * <h2>Why it is here and what frame it uses</h2>
 *
 * It has to live at the root: Next serves this file when nothing in the route tree matched,
 * which by definition is not inside `app/(site)`. A root file's client components land in
 * every route's first load, so this one renders `MinimalShell` rather than the full site
 * header — that component carries the measurement (83.3 KiB on the checkout, on every editor
 * tab and on the admin console, for chrome none of them use).
 *
 * The full-shell 404 is `app/(site)/not-found.tsx`, which is what a `notFound()` from a
 * category page reaches. Both render the same `FailureState`, so the words are the same and
 * only the frame differs.
 *
 * <h2>`noindex`, and the status code is Next's</h2>
 *
 * Next serves this file with a 404 on its own; nothing here sets one, and nothing here prints
 * one either — a status code shown on a page is what makes a crawler index an error. The
 * private metadata shape is belt and braces, and it also strips the inherited Open Graph
 * block, so a dead link pasted into a chat does not unfurl as a tidy IdeaNest card implying
 * there is a page behind it.
 *
 * <h2>It cannot say what was being looked for</h2>
 *
 * `not-found.tsx` receives no props and Next does not hand it the requested path. That is a
 * limitation and it is also the right outcome: echoing a URL a stranger chose back into the
 * page is how a 404 becomes a reflected-content surface. So the copy is about what to do next
 * rather than about what was typed.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell.failure.pages.notFound');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function NotFound() {
  const { skipToContent } = await shellCopy();
  const failure = await failureCopy();
  const t = await getTranslations('shell.failure.pages.notFound');

  return (
    <MinimalShell skipToContent={skipToContent}>
      <FailureState
        copy={failure}
        title={t('title')}
        description={<p>{t('description')}</p>}
        action={<FailureAction href="/">{t('action')}</FailureAction>}
      />
    </MinimalShell>
  );
}
