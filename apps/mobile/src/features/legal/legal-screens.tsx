import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  LEGAL_DOCUMENTS,
  archivedVersionOf,
  isLegalDocumentSlug,
  kindOf,
  legalPath,
  paragraphsOf,
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
  IconButton,
  Skeleton,
  SkeletonGroup,
  Story,
  announce,
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
 * The body is plain text split on blank lines (`paragraphsOf`, shared with the web), drawn as
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

      {paragraphsOf(document.body).map((paragraph, index) => (
        // The paragraphs have no identity of their own and never reorder within a version. A single
        // line break collapses to a space, as a browser draws the same text.
        <Paragraph key={index}>{paragraph.replace(/\s*\n\s*/gu, ' ')}</Paragraph>
      ))}

    </StaticPage>
  );
}

/** Governing language and digest, before the text — `LegalDocumentPage`'s list. */
function Provenance({ document }: { readonly document: LegalDocument }) {
  const t = useT('legal');
  const locale = useLocale();
  return (
    <RuledList testID="legal-provenance">
      {document.locale === locale ? null : (
        <Paragraph testID="legal-governing-language">{t('meta.governingLanguage')}</Paragraph>
      )}
      <ContentHash hash={document.contentHash} />
    </RuledList>
  );
}

/**
 * The SHA-256 of the text, which is what an acceptance is taken over.
 *
 * A 64-character hex run has no break opportunity, so a zero-width space every eight characters
 * lets it wrap on a narrow screen instead of overflowing it (the web's `break-all`). Read aloud in
 * groups of four rather than as one 64-letter word, and copied by the button beside it.
 */
function ContentHash({ hash }: { readonly hash: string }) {
  const t = useT('legal');
  const tContent = useT('mobile.content');
  const [prefix, suffix] = t('meta.contentHash', { hash: HASH_SLOT }).split(HASH_SLOT);

  const copy = async () => {
    let copied = false;
    try {
      copied = await Clipboard.setStringAsync(hash);
    } catch {
      copied = false;
    }
    announce(copied ? tContent('hashCopied') : tContent('copyFailed'), { assertive: !copied });
  };

  return (
    <View style={styles.hashRow}>
      <Story
        style={styles.hashText}
        accessibilityLabel={t('meta.contentHash', { hash: groupsOf(hash, 4).join(' ') })}
        testID="legal-hash"
      >
        {prefix}
        <Text style={styles.mono}>{wrappable(hash)}</Text>
        {suffix}
      </Story>
      <IconButton
        icon={Glyphs.Copy}
        label={tContent('copyHash')}
        variant="ghost"
        size="sm"
        onPress={() => void copy()}
        testID="legal-copy-hash"
      />
    </View>
  );
}

/** A marker no catalogue sentence contains, to split the sentence around the digest. */
const HASH_SLOT = '\u0000';
const ZERO_WIDTH_SPACE = '\u200B';

export function wrappable(hash: string): string {
  return groupsOf(hash, 8).join(ZERO_WIDTH_SPACE);
}

function groupsOf(value: string, size: number): string[] {
  const groups: string[] = [];
  for (let at = 0; at < value.length; at += size) groups.push(value.slice(at, at + size));
  return groups;
}

/** A NavRow's height (`settings-row.tsx`: the touch target and its padding). */
const ROW_SKELETON = size.touchTarget + spacing[3];

const styles = StyleSheet.create({
  skeletonRows: { gap: spacing[1] },
  skeletonText: { gap: spacing[3] },
  hashRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  hashText: { flex: 1 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
