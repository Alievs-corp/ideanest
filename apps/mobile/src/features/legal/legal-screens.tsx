import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  LEGAL_DOCUMENTS,
  archivedVersionOf,
  isLegalDocumentSlug,
  kindOf,
  legalPath,
  readableParagraphsOf,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalDocumentSummary,
} from '@ideanest/legal/documents';
import { NotFoundState } from '../../components/not-found-state';
import {
  Paragraph,
  RichParagraph,
  RuledList,
  StaticPage,
} from '../../components/content/static-page';
import {
  ContentSheet,
  Skeleton,
  SkeletonGroup,
  type ScreenError,
} from '../../components/ui';
import { Glyphs } from '../../icons';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { size, spacing } from '../../theme';
import { NavRow, RowGroup } from '../settings/settings-row';
import { useArchivedLegalDocument, useLegalCatalogue, useLegalDocument } from './api';

/**
 * The legal index, a document in force and an archived version — the web's `/legal`,
 * `/legal/[document]` and `/legal/[document]/v/[version]`, issue #164.
 *
 * <h2>Four states that are four facts</h2>
 *
 * Loading is the page's shape in skeleton. A 404 is "not published", said plainly. A failure with
 * nothing cached is the web's "could not be loaded" with a retry — never eight "Not published yet"
 * rows, which during an outage would be a false statement about the platform (#147). A cached copy
 * whose refresh failed is drawn with the failure above it, and offline with the offline notice;
 * the copy is a versioned, hash-stamped text, so it stays honest while it is old.
 *
 * <h2>The text is text</h2>
 *
 * The body is plain text split on blank lines (`readableParagraphsOf`, shared with the web), drawn as
 * paragraphs: no markdown, no HTML, no web view. Version number and effective date are not shown
 * (owner's decision, 2026-10-11, as on the web); the governing-language note and digest come first.
 */

export function LegalIndexScreen() {
  const t = useT('legal');
  const tAll = useT();
  const locale = useLocale();
  const router = useRouter();
  const online = useOnline();
  const catalogue = useLegalCatalogue(locale);
  const [pulling, setPulling] = useState(false);
  const inForce = new Map((catalogue.data ?? []).map((summary) => [summary.kind, summary]));

  const status = (summary: LegalDocumentSummary | undefined): string | undefined =>
    summary === undefined ? t('index.notPublished') : undefined;

  return (
    <StaticPage
      title={t('index.title')}
      summary={t('index.summary')}
      sharePath="/legal"
      hasContent={catalogue.data !== undefined || !catalogue.isError}
      error={useFailure(catalogue, t('unavailable.indexTitle'))}
      offlineNotice={online || catalogue.data === undefined ? null : tAll('mobile.offline.banner')}
      onRefresh={() => {
        setPulling(true);
        void catalogue.refetch().finally(() => setPulling(false));
      }}
      refreshing={pulling}
      testID="legal-index"
      sheet={
        <ContentSheet>
          {catalogue.data === undefined ? (
            <SkeletonGroup label={tAll('mobile.content.loadingLegal')}>
              <View style={styles.skeletonRows}>
                {LEGAL_DOCUMENTS.map((slug) => (
                  <Skeleton key={slug} height={ROW_SKELETON} radius="md" />
                ))}
              </View>
            </SkeletonGroup>
          ) : (
            <RowGroup testID="legal-documents">
              {LEGAL_DOCUMENTS.map((slug) => (
                <NavRow
                  key={slug}
                  label={t(`documents.${slug}.title`)}
                  detail={status(inForce.get(kindOf(slug)))}
                  icon={Glyphs.DocumentText}
                  onPress={() => router.push(legalPath(slug))}
                  testID={`legal-row-${slug}`}
                />
              ))}
            </RowGroup>
          )}
        </ContentSheet>
      }
    >
      <Paragraph>{t('index.lead')}</Paragraph>
    </StaticPage>
  );
}

export function LegalDocumentScreen({ document: segment }: { readonly document: string }) {
  if (!isLegalDocumentSlug(segment)) return <NotFoundState testID="legal-not-found" />;
  return <CurrentDocument slug={segment} />;
}

export function ArchivedLegalDocumentScreen({
  document: segment,
  version: versionSegment,
}: {
  readonly document: string;
  readonly version: string;
}) {
  const version = archivedVersionOf(versionSegment);
  if (!isLegalDocumentSlug(segment) || version === null) return <NotFoundState testID="legal-not-found" />;
  return <ArchivedDocument slug={segment} version={version} />;
}

/**
 * The failure a legal screen shows, or none.
 *
 * Offline with a copy on the phone, the offline notice says it all: a danger alert that the text
 * "could not be loaded" above a text that is on screen would contradict it. Offline with nothing
 * cached, the reason is the connection, so the sentence says so rather than blaming the service.
 */
function useFailure(
  query: { readonly isError: boolean; readonly isFetching: boolean; readonly data: unknown; refetch: () => unknown },
  title: string,
): ScreenError | null {
  const t = useT();
  const online = useOnline();
  if (!query.isError) return null;
  if (!online && query.data !== undefined) return null;
  return {
    title,
    description: online ? t('legal.unavailable.body') : t('mobile.offline.nothingCached'),
    onRetry: () => void query.refetch(),
    retrying: query.isFetching,
  };
}

function CurrentDocument({ slug }: { readonly slug: LegalDocumentSlug }) {
  const locale = useLocale();
  const query = useLegalDocument(slug, locale);
  return <DocumentPage slug={slug} query={query} />;
}

function ArchivedDocument({ slug, version }: { readonly slug: LegalDocumentSlug; readonly version: number }) {
  const locale = useLocale();
  const query = useArchivedLegalDocument(slug, version, locale);
  // An archived version that does not exist is an address that names nothing, as on the web.
  if (query.data?.state === 'unpublished') return <NotFoundState testID="legal-not-found" />;
  return <DocumentPage slug={slug} query={query} archivedVersion={version} />;
}

type DocumentQuery = ReturnType<typeof useLegalDocument>;

function DocumentPage({
  slug,
  query,
  archivedVersion,
}: {
  readonly slug: LegalDocumentSlug;
  readonly query: DocumentQuery;
  readonly archivedVersion?: number;
}) {
  const t = useT('legal');
  const tAll = useT();
  const online = useOnline();
  const [pulling, setPulling] = useState(false);
  const answer = query.data;
  const path = archivedVersion === undefined ? legalPath(slug) : legalPath(slug, archivedVersion);
  const failure = useFailure(query, t('unavailable.title'));

  const shared = {
    sharePath: path,
    error: failure,
    offlineNotice: online || answer === undefined ? null : tAll('mobile.offline.banner'),
    onRefresh: () => {
      setPulling(true);
      void query.refetch().finally(() => setPulling(false));
    },
    refreshing: pulling,
    testID: 'legal-document',
  };

  if (answer?.state === 'unpublished') {
    return (
      <StaticPage {...shared} title={t(`documents.${slug}.title`)} summary={t('notPublished.summary')}>
        <Paragraph testID="legal-not-published">{t('notPublished.body')}</Paragraph>
        <RichParagraph>{(tag) => tag.link('/legal')(t('backToIndex'))}</RichParagraph>
      </StaticPage>
    );
  }

  if (answer === undefined) {
    return (
      <StaticPage
        {...shared}
        hasContent={!query.isError}
        title={t(`documents.${slug}.title`)}
        summary={t(`documents.${slug}.summary`)}
      >
        <SkeletonGroup label={tAll('mobile.content.loadingDocument')}>
          <View style={styles.skeletonText}>
            {[0, 1, 2, 3, 4, 5].map((line) => (
              <Skeleton key={line} width={line % 3 === 2 ? '60%' : '100%'} />
            ))}
          </View>
        </SkeletonGroup>
      </StaticPage>
    );
  }

  const document = answer.document;
  return (
    <StaticPage
      {...shared}
      title={document.title}
      summary={t(`documents.${slug}.summary`)}
    >
      <Provenance document={document} />

      {archivedVersion === undefined ? null : (
        <RichParagraph tone="secondary" testID="legal-archive-notice">
          {(tag) => (
            <>
              {t('archive.notice')} {tag.link(legalPath(slug))(t('archive.readCurrent'))}
            </>
          )}
        </RichParagraph>
      )}

      {readableParagraphsOf(document.body).map((paragraph, index) => (
        // The paragraphs have no identity of their own and never reorder within a version. A single
        // line break collapses to a space, as a browser draws the same text.
        <Paragraph key={index}>{paragraph.replace(/\s*\n\s*/gu, ' ')}</Paragraph>
      ))}

    </StaticPage>
  );
}

/** The governing-language note, before the text, when the reader's language was not available. */
function Provenance({ document }: { readonly document: LegalDocument }) {
  const t = useT('legal');
  const locale = useLocale();
  if (document.locale === locale) return null;
  return (
    <RuledList testID="legal-provenance">
      <Paragraph testID="legal-governing-language">{t('meta.governingLanguage')}</Paragraph>
    </RuledList>
  );
}

/** A NavRow's height (`settings-row.tsx`: the touch target and its padding). */
const ROW_SKELETON = size.touchTarget + spacing[3];

const styles = StyleSheet.create({
  skeletonRows: { gap: spacing[1] },
  skeletonText: { gap: spacing[3] },
});
