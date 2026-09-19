import { FailureAction, FailureState } from '../../../components/shell/FailureState';
import { failureCopy } from '../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

/**
 * The 404 for a route inside the public site — §4.13 WS-09, issue #263.
 *
 * <h2>This is the one that keeps the whole shell</h2>
 *
 * It renders inside `app/(site)/layout.tsx`, so the header, the navigation, the search field
 * and the footer are all there — WS-09's "inside the shell rather than replacing it", in full.
 * It costs nothing extra: every route in this group already carries that chrome.
 *
 * It is what a `notFound()` from a category page reaches — `/categories/gmaes`, or a
 * subcategory that does not belong to the category in its own URL. Those are the 404s somebody
 * arrives at from a search result with a stale link, and the ones where having the navigation
 * on hand is worth most.
 *
 * The root `app/not-found.tsx` handles a request that matched no route at all, on a lighter
 * frame, and `MinimalShell` carries the measurement behind that split. The words are the same
 * because they come from the same component.
 *
 * <h2>No metadata</h2>
 *
 * The root 404 declares the `noindex` shape, and Next resolves metadata down the segment tree
 * — a second declaration here would be a second place for it to be spelled. What differs
 * between the two files is the frame and nothing else.
 */
export default async function SiteNotFound() {
  const failure = await failureCopy();
  const t = await getTranslations('shell.failure.pages.notFound');

  return (
    <FailureState
      copy={failure}
      title={t('title')}
      description={<p>{t('description')}</p>}
      action={<FailureAction href="/">{t('action')}</FailureAction>}
    />
  );
}
