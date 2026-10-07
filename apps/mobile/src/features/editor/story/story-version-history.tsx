import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@ideanest/api-client';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise } from '@ideanest/messages/plurals';
import type { ProjectEdit, StoryVersionSummary } from '@ideanest/campaign-editor/contract';
import {
  readStoryDocument,
  spansToText,
  storyCharacterCount,
  type StoryBlock,
  type StoryDocument,
} from '@ideanest/campaign-editor/story';
import {
  Body,
  Caption,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  InlineAlert,
  MotionBudgetProvider,
  Pill,
  Skeleton,
  SkeletonGroup,
  useReducedMotion,
} from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { useHeldWhileShut } from '../../../lib/app-lock';
import { formatCount, formatDateTime, useT } from '../../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { charactersPhrase, type StoryCopy } from './story-copy';
import { getStoryVersion, listStoryVersions, restoreStoryVersion } from './story-api';

/**
 * "Earlier versions" — the web's `StoryVersionHistory` drawer as a full-screen modal (#162).
 *
 * <p>Loaded each time it opens (`GET …/story/versions`), because a creator who opens it after
 * twenty minutes of writing wants what is there now. Each version card says "Version N" (the
 * first "most recent"), when, and how many characters; "Preview" expands the version's blocks as
 * labelled text (`GET …/versions/{number}`) — deliberately not a rendering of the story — and
 * "Restore" asks first in a white dialog: "Keep what I have", or lime "Restore this version" with
 * near-black text, the one action the dialog exists for. The restore (`POST …/restore`) answers
 * the whole project; the panel takes it as the new truth and re-seeds the editor from it.
 *
 * <p>Loading, failed with "Try again", and "No earlier versions yet" are drawn here. Motion: the
 * platform's modal presentation, none under Reduce Motion; nothing else moves.
 */
export interface StoryVersionHistoryProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly projectId: string;
  readonly copy: StoryCopy;
  /** Characters in the story as it now stands, so the confirmation can name what is replaced. */
  readonly currentCharacters: number;
  /** Offline: the history can be read from what loads, but nothing can be restored. */
  readonly readOnly: boolean;
  /**
   * A change is still on its way to the service (queued, in the air, or refused and kept). A
   * restore now could be overtaken by it — the older story landing over the restored one — so
   * Restore waits, and says why.
   */
  readonly waiting: boolean;
  /**
   * The story on screen is held back by an incomplete block, so it is NOT kept as a version: the
   * confirmation says the unsaved changes are discarded instead of promising they are kept.
   */
  readonly discardsHeld: boolean;
  readonly onRestored: (project: ProjectEdit) => void;
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly versions: readonly StoryVersionSummary[] };

type Preview =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly document: StoryDocument };

/** The service's own sentence where it wrote one; the catalogue's otherwise. */
function failureMessage(cause: unknown, fallback: string, unreachable: string): string {
  if (cause instanceof ApiError) return cause.problem?.detail ?? cause.problem?.title ?? fallback;
  return unreachable;
}

export function StoryVersionHistory({
  visible: requested,
  onClose,
  projectId,
  copy,
  currentCharacters,
  readOnly,
  waiting,
  discardsHeld,
  onRestored,
}: StoryVersionHistoryProps) {
  // Held while the app lock is shut: a window opened behind it would sit above it (#319).
  const visible = useHeldWhileShut(requested);
  const history = copy.story.history;
  const t = copy.mobile;
  const tKit = useT('mobile.kitForm');
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [open, setOpen] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: 'loading' });
  const [confirming, setConfirming] = useState<StoryVersionSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const fetchList = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setLoad({ status: 'loading' });
      try {
        const versions = await listStoryVersions(projectId, signal);
        if (signal?.aborted === true) return;
        setLoad({ status: 'ready', versions });
      } catch (cause) {
        if (signal?.aborted === true) return;
        setLoad({ status: 'failed', message: failureMessage(cause, t('history.loadFailed'), t('history.unreachable')) });
      }
    },
    [projectId, t],
  );

  useEffect(() => {
    if (!visible) return undefined;
    setOpen(null);
    const controller = new AbortController();
    void fetchList(controller.signal);
    return () => controller.abort();
  }, [visible, fetchList]);

  /** The preview asked for last; an answer for any other is stale and dropped. */
  const previewRequest = useRef<AbortController | null>(null);
  useEffect(() => () => previewRequest.current?.abort(), []);

  function hidePreview(): void {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setOpen(null);
  }

  async function showPreview(number: number): Promise<void> {
    previewRequest.current?.abort();
    const request = new AbortController();
    previewRequest.current = request;
    setOpen(number);
    setPreview({ status: 'loading' });
    try {
      const detail = await getStoryVersion(projectId, number, request.signal);
      if (previewRequest.current !== request) return;
      const document = readStoryDocument(detail.document);
      // A version a newer editor wrote: showing it as best we can would invite a restore into a
      // document this build could not then save.
      setPreview(
        document === null
          ? { status: 'failed', message: t('history.newerFormat') }
          : { status: 'ready', document },
      );
    } catch (cause) {
      if (previewRequest.current !== request || request.signal.aborted) return;
      setPreview({
        status: 'failed',
        message: failureMessage(cause, t('history.versionFailed'), t('history.unreachable')),
      });
    }
  }

  async function restore(version: StoryVersionSummary): Promise<void> {
    setRestoring(true);
    setRestoreError(null);
    try {
      const project = await restoreStoryVersion(projectId, version.number);
      setConfirming(null);
      onRestored(project);
    } catch (cause) {
      setRestoreError(failureMessage(cause, t('history.restoreFailed'), t('history.unreachable')));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType={reduced ? 'none' : 'slide'}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      allowSwipeDismissal={!restoring}
      onRequestClose={() => {
        if (!restoring) onClose();
      }}
      statusBarTranslucent
    >
      <MotionBudgetProvider level="none">
        <View style={styles.root} testID="story-history">
          <View style={[styles.header, { paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + spacing[3] }]}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
              {history.title}
            </Text>
            <IconButton
              icon={Glyphs.Close}
              label={tKit('close')}
              variant="ghost"
              size="sm"
              disabled={restoring}
              onPress={onClose}
              testID="story-history-close"
            />
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing[8] }]}
          >
            <Body>{history.description}</Body>
            {waiting ? (
              <InlineAlert
                variant="info"
                politeness="polite"
                description={t('history.waitForSave')}
                testID="story-history-waiting"
              />
            ) : null}

            {load.status === 'loading' ? (
              <SkeletonGroup label={history.loadingLabel} testID="story-history-loading">
                <View style={styles.list}>
                  {[0, 1, 2].map((row) => (
                    <Skeleton key={row} height={72} radius="lg" />
                  ))}
                </View>
              </SkeletonGroup>
            ) : load.status === 'failed' ? (
              <ErrorState
                title={history.failedTitle}
                description={load.message}
                onRetry={() => void fetchList()}
                testID="story-history-failed"
              />
            ) : load.versions.length === 0 ? (
              <EmptyState
                icon={Glyphs.Clock}
                title={history.emptyTitle}
                description={history.emptyDescription}
                testID="story-history-empty"
              />
            ) : (
              <View style={styles.list}>
                {load.versions.map((version, position) => (
                  <VersionCard
                    key={version.number}
                    copy={copy}
                    version={version}
                    newest={position === 0}
                    expanded={open === version.number}
                    preview={open === version.number ? preview : null}
                    readOnly={readOnly || waiting}
                    onToggle={() => (open === version.number ? hidePreview() : void showPreview(version.number))}
                    onRestore={() => {
                      setRestoreError(null);
                      setConfirming(version);
                    }}
                  />
                ))}
              </View>
            )}
          </ScrollView>

          <Dialog
            open={confirming !== null}
            onClose={() => {
              if (!restoring) setConfirming(null);
            }}
            title={
              confirming === null
                ? history.restoreTitle
                : fillPlaceholders(history.confirmTitle, { number: String(confirming.number) })
            }
            description={history.replaceWarning}
            showClose={false}
            dismissOnScrim={false}
            testID="story-restore"
            footer={
              <>
                {/* Lime, near-black text: the action this dialog exists for. Recoverable, so not danger. */}
                <Pill
                  label={restoring ? history.restoring : history.restoreThis}
                  variant="accent"
                  fullWidth
                  wrap
                  busy={restoring}
                  disabled={restoring || readOnly || waiting}
                  onPress={() => {
                    if (confirming !== null) void restore(confirming);
                  }}
                  testID="story-restore-confirm"
                />
                <Pill
                  label={history.keepMine}
                  variant="ghost"
                  fullWidth
                  wrap
                  disabled={restoring}
                  onPress={() => setConfirming(null)}
                  testID="story-restore-keep"
                />
              </>
            }
          >
            {confirming === null ? null : (
              <View style={styles.confirm}>
                <Body>
                  {t('history.savedAt', {
                    number: String(confirming.number),
                    date: formatDateTime(confirming.createdAt, copy.locale),
                    characters: charactersPhrase(copy, confirming.characters),
                  })}
                </Body>
                <Body testID="story-restore-current">
                  {discardsHeld
                    ? // Held back by an incomplete block, so never saved: nothing keeps it as a version.
                      t('history.discardsHeld')
                    : t('history.currentHolds', { characters: charactersPhrase(copy, currentCharacters) })}
                </Body>
                {restoreError === null ? null : (
                  <InlineAlert variant="danger" description={restoreError} testID="story-restore-failed" />
                )}
              </View>
            )}
          </Dialog>
        </View>
      </MotionBudgetProvider>
    </Modal>
  );
}

function VersionCard({
  copy,
  version,
  newest,
  expanded,
  preview,
  readOnly,
  onToggle,
  onRestore,
}: {
  readonly copy: StoryCopy;
  readonly version: StoryVersionSummary;
  readonly newest: boolean;
  readonly expanded: boolean;
  readonly preview: Preview | null;
  readonly readOnly: boolean;
  readonly onToggle: () => void;
  readonly onRestore: () => void;
}) {
  const history = copy.story.history;
  const t = copy.mobile;
  const number = String(version.number);
  const testID = `story-version-${version.number}`;

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.cardText}>
        <Text style={styles.version}>
          {t('history.version', { number })}
          {/* "Most recent" is a word, never only a shade of grey. */}
          {newest ? <Text style={styles.newest}>{`  ${t('history.mostRecent')}`}</Text> : null}
        </Text>
        <Caption>
          {`${formatDateTime(version.createdAt, copy.locale)} · ${charactersPhrase(copy, version.characters)}`}
        </Caption>
      </View>
      <View style={styles.actions}>
        <Pill
          label={expanded ? t('history.hide') : history.preview}
          accessibilityLabel={
            expanded
              ? t('history.hideVersion', { number })
              : fillPlaceholders(history.previewVersion, { number })
          }
          variant="ghost"
          size="sm"
          onPress={onToggle}
          testID={`${testID}-preview`}
        />
        <Pill
          label={history.restore}
          accessibilityLabel={fillPlaceholders(history.restoreVersion, { number })}
          variant="ghost"
          size="sm"
          disabled={readOnly}
          onPress={onRestore}
          testID={`${testID}-restore`}
        />
      </View>

      {preview === null ? null : (
        <View style={styles.preview} testID={`${testID}-content`}>
          {preview.status === 'loading' ? (
            <Caption>{history.loadingVersion}</Caption>
          ) : preview.status === 'failed' ? (
            <InlineAlert variant="warning" description={preview.message} />
          ) : (
            <VersionPreview copy={copy} document={preview.document} />
          )}
        </View>
      )}
    </View>
  );
}

/** A version's blocks as labelled text — enough to recognise the draft, honest about not being the page. */
function VersionPreview({ copy, document }: { readonly copy: StoryCopy; readonly document: StoryDocument }) {
  const history = copy.story.history;
  const vocabulary = copy.story.vocabulary;
  if (document.blocks.length === 0) return <Caption>{history.noBlocks}</Caption>;
  const count = document.blocks.length;
  return (
    <View style={styles.blocks}>
      <Caption>
        {fillPlaceholders(pluralise(copy.locale, history.previewSummary, count), {
          count: String(count),
          characters: formatCount(storyCharacterCount(document), copy.locale),
        })}
      </Caption>
      {document.blocks.map((block, index) =>
        // A divider has no text; its kind is all there is to say about it.
        block.type === 'rule' ? (
          <Text key={index} style={[styles.line, styles.kind]}>
            {history.divider}
          </Text>
        ) : (
          <Text key={index} style={styles.line}>
            <Text style={styles.kind}>{`${vocabulary.blockLabel[block.type]}: `}</Text>
            {blockText(block)}
          </Text>
        ),
      )}
    </View>
  );
}

function blockText(block: Exclude<StoryBlock, { type: 'rule' }>): string {
  switch (block.type) {
    case 'heading':
      return block.text;
    case 'paragraph':
    case 'quote':
      return spansToText(block.spans);
    case 'list':
      return block.items.map((item) => spansToText(item)).join(' · ');
    case 'image':
      return block.alt;
    case 'embed':
      return block.title;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    ...font.semibold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    color: colors.textPrimary,
  },
  body: { flex: 1 },
  content: { gap: spacing[5], padding: spacing[5] },
  list: { gap: spacing[3] },
  card: {
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardText: { gap: spacing[1] },
  version: { ...font.medium, fontSize: fontSize.row, lineHeight: lineHeight.small, color: colors.textPrimary },
  newest: { ...font.regular, fontSize: fontSize.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  preview: {
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  blocks: { gap: spacing[2] },
  line: { ...font.regular, fontSize: fontSize.caption, lineHeight: lineHeight.small, color: colors.textSecondary },
  kind: { color: colors.textTertiary },
  confirm: { gap: spacing[3] },
});
