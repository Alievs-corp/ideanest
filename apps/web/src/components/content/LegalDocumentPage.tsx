import { getTranslations } from 'next-intl/server';
import { Link } from '../../i18n/navigation';
import { StaticPage } from './StaticPage';
import type { Locale } from '../../lib/i18n/locale';
import {
  legalPath,
  readableParagraphsOf,
  type LegalDocument,
  type LegalDocumentSlug,
} from '@ideanest/legal/documents';

/**
 * One version of one of §22.2's documents, rendered — issue #439.
 *
 * <h2>No version number and no effective date on the page</h2>
 *
 * #439 asked for both to be visible; the owner decided against it on 2026-10-11. The admin-authored
 * text carries its own heading line, and the console keeps the version history. The archive routes
 * still exist, so an acceptance record naming a version can still be followed to its text.
 *
 * <h2>The content hash is printed too</h2>
 *
 * It looks like plumbing and it is the opposite. V65 stores the SHA-256 of the body beside the
 * body, and #429 has SİMA sign that hash — so a creator who signed version 4 of the creator
 * agreement can check the digest on this page against the one on their signature and establish,
 * without trusting the platform, that this is the text they signed. Hiding it would remove the
 * only thing that makes the signature checkable by the person who made it.
 *
 * <h2>The language a reader got, when it is not the one they asked for</h2>
 *
 * `LegalDocuments.inForce` falls back to the governing Azerbaijani text rather than answering
 * 404, and this page says so when it happens. The alternative was tried and rejected in the
 * service: a reader shown a blank page has been told nothing, and a reader shown the governing
 * text without being told which language it is in has been told something confusing about a
 * document that binds them.
 *
 * <h2>Nothing published is a state, not an error</h2>
 *
 * §22.2 requires the platform to *have* eight documents. This repository has the machinery and
 * none of the words — they are #423's adviser's — so a document with no published version says
 * so plainly. Not a 404, because the address is real and permanent and a 404 tells a crawler to
 * stop asking; not an error page, because nothing went wrong.
 *
 * <h2>Motion: none. No client island. No cookie.</h2>
 *
 * This component is why the route stays static. It reads no cookie, opens no context provider
 * and imports nothing from the `@ideanest/ui` barrel — `packages/ui/src/server.ts` records that
 * the barrel pulls `createContext` into the server graph and fails `next build` naming a
 * component the page never used. `StaticPage` and `Link` are the whole of its dependencies.
 */

export interface LegalDocumentPageProps {
  readonly slug: LegalDocumentSlug;
  readonly locale: Locale;
  /** `null` when no version of this document is published, which is a state this page renders. */
  readonly document: LegalDocument | null;
  /**
   * The version being read, when it is an archived one.
   *
   * Present only on `/legal/{document}/v/{version}`. It changes what the page says about itself
   * — an archived version is explicitly not the one in force, and a reader who arrived from an
   * acceptance record needs to be told that before they read a word of it.
   */
  readonly archivedVersion?: number;
}

export async function LegalDocumentPage({
  slug,
  locale,
  document,
  archivedVersion,
}: LegalDocumentPageProps) {
  const t = await getTranslations('legal');

  if (document === null) {
    return (
      <StaticPage title={t(`documents.${slug}.title`)} summary={t('notPublished.summary')}>
        <p>{t('notPublished.body')}</p>
        <p>
          <Link href="/legal" className="text-fg underline underline-offset-4">
            {t('backToIndex')}
          </Link>
        </p>
      </StaticPage>
    );
  }

  /*
   * The service answers in the language it has. It only ever falls back to Azerbaijani, so this
   * is a comparison against what was asked for rather than a general mismatch check.
   */
  const translated = document.locale === locale;

  return (
    <StaticPage title={document.title} summary={t(`documents.${slug}.summary`)}>
      {!translated && (
        <ul>
          <li>{t('meta.governingLanguage')}</li>
        </ul>
      )}

      {archivedVersion !== undefined && (
        <p className="text-fg-64">
          {t('archive.notice')}{' '}
          <Link href={legalPath(slug)} className="text-fg underline underline-offset-4">
            {t('archive.readCurrent')}
          </Link>
        </p>
      )}

      {readableParagraphsOf(document.body).map((paragraph, index) => (
        // The index is the key because the paragraphs have no identity of their own and the
        // list never reorders: it is rebuilt whole whenever a version is published, which is the
        // one case React's reconciliation would care about.
        // eslint-disable-next-line react/no-array-index-key
        <p key={index}>{paragraph}</p>
      ))}
    </StaticPage>
  );
}
