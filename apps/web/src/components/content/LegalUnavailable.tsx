import { getTranslations } from 'next-intl/server';
import { FailureAction, FailureState } from '../shell/FailureState';
import { failureCopy } from '../../lib/i18n/shell-copy.server';

/**
 * A legal read that failed — issue #147.
 *
 * <h2>Why this is not the "not published" page</h2>
 *
 * `LegalDocumentPage`'s not-published branch is the service answering 404: IdeaNest has no
 * version of the document in force, and the page says so because §22.2 requires the document
 * and hiding its absence would be worse. This is the other answer — a 5xx, a timeout, a DNS
 * failure — which says nothing about whether the document exists. Drawing it as "not published"
 * told readers on 2026-09-28 that IdeaNest had no terms of use; drawing it as a failure tells
 * them what is actually true, which is that the page could not be loaded.
 *
 * <h2>`FailureState`, with a link rather than a button</h2>
 *
 * The same shape every failure on the site takes, so the page reads as the site's failure and
 * not as a document. The way out is a link to the same address, because this is a Server
 * Component and there is no `reset()` to call: following it asks the service again. The
 * routes are dynamic and Next's data cache holds only 200 responses, so the retry is a real
 * one rather than a replay of the failure — `lib/legal/server.ts` has the reasoning.
 *
 * Motion: none, for the reason `FailureState` gives.
 */
export async function LegalUnavailable({
  retryHref,
  scope,
}: {
  /** The address that failed, so the action asks again. */
  readonly retryHref: string;
  /** One document, or the index of all eight. Only the heading differs. */
  readonly scope: 'document' | 'index';
}) {
  const [t, copy] = await Promise.all([getTranslations('legal.unavailable'), failureCopy()]);

  return (
    <FailureState
      copy={copy}
      title={scope === 'index' ? t('indexTitle') : t('title')}
      description={<p>{t('body')}</p>}
      action={<FailureAction href={retryHref}>{t('action')}</FailureAction>}
    />
  );
}
