import { getTranslations } from 'next-intl/server';
import { Link } from '../../i18n/navigation';
import { StaticPage } from './StaticPage';
import { formatInstant, SERVER_TIME_ZONE } from '../../lib/projects/deadline';
import { localeOrDefault, type Locale } from '../../lib/i18n/locale';
import {
  legalPath,
  paragraphsOf,
  type LegalDocument,
  type LegalDocumentSlug,
} from '@ideanest/legal/documents';

/**
 * One version of one of §22.2's documents, rendered — issue #439.
 *
 * <h2>The version and the effective date are on the page, not in the metadata</h2>
 *
 * #439 asks for both to be *visible*, and that is a stronger requirement than it sounds. A
 * legal document without a version is a document nobody can refer to: an acceptance record
 * names a number, and a reader who cannot see the number on the page cannot check that the two
 * agree. The effective date is the second half — "since when does this bind me" is the question
 * a person has when they arrive here already worried.
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
          <Link href="/legal" className="text-white underline underline-offset-4">
            {t('backToIndex')}
          </Link>
        </p>
      </StaticPage>
    );
  }

  const effective =
    document.effectiveFrom === null
      ? null
      : formatInstant(document.effectiveFrom, SERVER_TIME_ZONE, localeOrDefault(locale));

  /*
   * The service answers in the language it has. It only ever falls back to Azerbaijani, so this
   * is a comparison against what was asked for rather than a general mismatch check.
   */
  const translated = document.locale === locale;

  return (
    <StaticPage title={document.title} summary={t(`documents.${slug}.summary`)}>
      {/*
        The provenance block, before the text. It is deliberately the first thing after the
        heading: everything below it binds the reader, and which version and from when is the
        context that makes the rest readable rather than a wall of prose.
      */}
      <ul>
        <li>
          {archivedVersion === undefined
            ? t('meta.version', { version: document.version })
            : t('meta.archivedVersion', { version: document.version })}
        </li>
        {effective !== null && <li>{t('meta.effectiveFrom', { date: effective })}</li>}
        {!translated && <li>{t('meta.governingLanguage')}</li>}
        <li>
          {/*
            `break-all` because a 64-character hex digest has no break opportunities of its own
            and would otherwise push the measure wide on a narrow screen — CLAUDE.md's rule that
            the page body must never scroll horizontally.
          */}
          <span className="break-all">{t('meta.contentHash', { hash: document.contentHash })}</span>
        </li>
      </ul>

      {archivedVersion !== undefined && (
        <p className="text-white/64">
          {t('archive.notice')}{' '}
          <Link href={legalPath(slug)} className="text-white underline underline-offset-4">
            {t('archive.readCurrent')}
          </Link>
        </p>
      )}

      {paragraphsOf(document.body).map((paragraph, index) => (
        // The index is the key because the paragraphs have no identity of their own and the
        // list never reorders: it is rebuilt whole whenever a version is published, which is the
        // one case React's reconciliation would care about.
        // eslint-disable-next-line react/no-array-index-key
        <p key={index}>{paragraph}</p>
      ))}

      {archivedVersion === undefined && document.version > 1 && (
        <p className="text-white/64">
          {t('archive.previousAvailable')}{' '}
          <Link
            href={legalPath(slug, document.version - 1)}
            className="text-white underline underline-offset-4"
          >
            {t('archive.readVersion', { version: document.version - 1 })}
          </Link>
        </p>
      )}
    </StaticPage>
  );
}
