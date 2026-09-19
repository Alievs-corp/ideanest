import { FailureAction, FailureState } from '../../../components/shell/FailureState';
import { failureCopy } from '../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

/**
 * The 404 for `/u/{slug}` — §4.2 P-07, issue #274.
 *
 * <h2>It answers three different questions with one page, on purpose</h2>
 *
 * `notFound()` from the profile page is reached for an unknown slug, for a closed account, and
 * for an account whose profile is private. The service already refuses to tell those apart —
 * it answers 404 for all three rather than 403 for the last — and this page is the other half
 * of that promise. **The wording must never distinguish them.** "That profile is private" on
 * this page would hand back, from the browser, precisely the fact the endpoint spent a status
 * code hiding: that the person exists and has chosen not to be seen.
 *
 * So the copy is about a link that does not lead anywhere, which is true of all three, and the
 * sentence about accounts closing is there because it is the case a reader is most likely to
 * be able to act on — and because it is equally true whichever of the three they have met.
 *
 * <h2>The frame, and the words</h2>
 *
 * It renders inside `app/u/layout.tsx`, so the header, the search field and the footer are all
 * present — `app/(site)/not-found.tsx` makes that argument and this is the same case. The
 * heading carries the meaning and nothing on the page is lime or `--danger`: a link that has
 * gone stale is neither urgent nor a destructive failure (docs/ui-kit.md §8.6).
 *
 * No metadata. The root 404 declares the `noindex` shape and Next resolves metadata down the
 * segment tree; a second declaration here would be a second place for it to be spelled.
 */
export default async function ProfileNotFound() {
  const failure = await failureCopy();
  const t = await getTranslations('shell.failure.pages.profileNotFound');

  return (
    <FailureState
      copy={failure}
      title={t('title')}
      description={<p>{t('description')}</p>}
      action={<FailureAction href="/discover">{t('action')}</FailureAction>}
    />
  );
}
