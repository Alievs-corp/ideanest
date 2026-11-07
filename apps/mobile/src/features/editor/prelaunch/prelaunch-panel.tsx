import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { fillNodes, fillPlaceholders } from '@ideanest/messages/placeholders';
import {
  BLURB_MAX_CHARACTERS,
  TITLE_MAX_CHARACTERS,
  characterCount,
  draftFromProject,
  patchForField,
  validateBasics,
  type BasicsDraft,
  type BasicsErrors,
  type BasicsField,
} from '@ideanest/campaign-editor/basics';
import type { ProjectEdit, ProjectState } from '@ideanest/campaign-editor/contract';
import {
  basicsPanelCopyFrom,
  prelaunchPanelCopyFrom,
  type BasicsPanelCopy,
  type PrelaunchPanelCopy,
} from '@ideanest/campaign-editor/copy';
import { usePrelaunchPage } from '../../../api/queries';
import {
  Body,
  Caption,
  CharacterCount,
  Field,
  Icon,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Subheading,
  TextInput,
  Textarea,
  announce,
} from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { formatCount, pluralCategory, useT } from '../../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { basicsServerErrors, reseedDraft } from '../basics-panel';
import { CoverImageField } from '../cover-image-field';
import { useEditor } from '../editor-context';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';
import { prelaunchLink } from './api';

/**
 * The Pre-launch tab — the web's `PrelaunchPanel` (#162): what the pre-launch page will say, the
 * link to share, and how many people are waiting.
 *
 * <p><b>The content is the Basics, on purpose.</b> Title, summary and cover are the same fields as
 * the Basics tab's, on the editor's ONE shared autosave (`useEditor().autosave`): each change
 * queues its single-field patch (`patchForField`), sent 800ms after the last change or at once on
 * blur. A pre-launch page that promised something different from the campaign would promise it to
 * the people most likely to notice.
 *
 * <p><b>The page opens on approval, not on a button.</b> A creator used to open it from a draft,
 * which published a campaign nobody had reviewed. It is public only once moderation has approved
 * the campaign (`APPROVED` or `SCHEDULED`); before that the tab says so, and nobody else can see
 * the page. A `PRELAUNCH` campaign opened the old way is hidden like a draft.
 *
 * <p>While the page is open (APPROVED or SCHEDULED), the follower count is read from the public
 * `GET /v1/projects/{id}/prelaunch` — the app's own pre-launch screen's reader — and a count that
 * could not be read says so instead of drawing a zero nobody said. The link copies (announced) and
 * opens the share sheet.
 *
 * <p>Motion: none (the editor's budget). Offline, the fields are disabled.
 */
export function PrelaunchPanel() {
  const editor = useEditor();
  const { t, locale } = useEditorTranslators();
  const { characterCount: counter } = useEditorChromeCopy();
  const words = useMemo(() => prelaunchPanelCopyFrom(t, locale, counter), [t, locale, counter]);
  const basics = useMemo(() => basicsPanelCopyFrom(t), [t]);

  // As Basics: never seeded from the cache alone online, or a stale copy would be PATCHed over
  // edits made since. The skeleton stays until the editor says the form may be built.
  if (!editor.canSeed || editor.seed === null) {
    return editor.load === 'loading' || editor.load === 'ready' ? <Loading label={words.loadingLabel} /> : null;
  }
  return (
    <PrelaunchForm
      key={editor.projectId}
      seed={editor.seed}
      words={words}
      basics={basics}
    />
  );
}

const LOADING_ROWS = [0, 1, 2];

function Loading({ label }: { readonly label: string }) {
  return (
    <View style={styles.page}>
      <SkeletonGroup label={label} testID="prelaunch-loading">
        <View style={styles.form}>
          {LOADING_ROWS.map((row) => (
            <View key={row} style={styles.pair}>
              <Skeleton height={14} width="30%" />
              <Skeleton height={44} radius="lg" />
            </View>
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}

/** The states in which a pre-launch page is public and collects followers: cleared, not yet live. */
const COLLECTING: readonly ProjectState[] = ['APPROVED', 'SCHEDULED'];

/** Before approval: the page exists only as this tab's preview. */
const PENDING: readonly ProjectState[] = ['DRAFT', 'PRELAUNCH', 'SUBMITTED', 'CHANGES_REQUESTED'];

/** How long "Copied" stays on the button, as on the web. */
export const COPIED_MS = 2000;

function PrelaunchForm({
  seed,
  words,
  basics,
}: {
  readonly seed: ProjectEdit;
  readonly words: PrelaunchPanelCopy;
  readonly basics: BasicsPanelCopy;
}) {
  const editor = useEditor();
  const chrome = useEditorChromeCopy();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<BasicsDraft>(() => draftFromProject(seed));
  /** Fields whose text is only on this phone: changed, and refused before it was sent. */
  const localOnly = useRef(new Set<BasicsField>());

  // Seeded once; again only when the frame says so (`revision`), keeping what is only local.
  const seen = useRef(editor.revision);
  const latestSeed = useRef(seed);
  latestSeed.current = seed;
  useEffect(() => {
    if (seen.current === editor.revision) return;
    seen.current = editor.revision;
    setDraft((current) => reseedDraft(latestSeed.current, current, localOnly.current));
  }, [editor.revision]);

  const { autosave, readOnly, projectId } = editor;
  const project = editor.project ?? seed;
  const pending = PENDING.includes(project.state);
  const collecting = COLLECTING.includes(project.state);

  function change(field: BasicsField, next: BasicsDraft, sendNow = false): void {
    if (readOnly) return;
    setDraft(next);
    const patch = patchForField(field, next);
    if (patch === null) {
      localOnly.current.add(field);
      return;
    }
    localOnly.current.delete(field);
    autosave.save(patch);
    if (sendNow) autosave.flush();
  }

  const { failure } = autosave;
  const errors: BasicsErrors = {
    ...validateBasics(draft, basics.validation, {
      savedLaunchAt: draftFromProject(project).scheduledLaunchAt,
    }),
    ...basicsServerErrors(failure, basics),
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing[8] }]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      testID="prelaunch-panel"
    >
      <View style={styles.form}>
        {failure === null ? null : (
          <InlineAlert
            variant="danger"
            title={words.notSavedTitle}
            description={failure.message}
            testID="prelaunch-not-saved"
            action={
              <View style={styles.stack}>
                <Caption>{basics.notSavedDetail}</Caption>
                <View style={styles.start}>
                  <Pill
                    label={chrome.tryAgain}
                    variant="ghost"
                    size="sm"
                    disabled={!editor.online}
                    onPress={autosave.retry}
                    testID="prelaunch-retry"
                  />
                </View>
              </View>
            }
          />
        )}

        {pending ? (
          <InlineAlert
            variant="info"
            title={words.pendingHeading}
            description={words.pendingBody}
            testID="prelaunch-pending"
          />
        ) : collecting ? (
          <OpenCard projectId={projectId} words={words} />
        ) : (
          <InlineAlert
            variant="info"
            title={words.closedTitle}
            description={words.closedBody}
            testID="prelaunch-closed"
          />
        )}

        <View style={styles.pair}>
          <Subheading accessibilityRole="header">{words.saysHeading}</Subheading>
          <Body>{words.saysBody}</Body>
        </View>

        <Field
          label={words.title}
          required
          hint={fillPlaceholders(words.titleHint, { max: String(TITLE_MAX_CHARACTERS) })}
          error={errors.title}
        >
          <TextInput
            value={draft.title}
            autoComplete="off"
            disabled={readOnly}
            onChangeText={(title) => change('title', { ...draft, title })}
            onBlur={autosave.flush}
            testID="prelaunch-title"
          />
          <CharacterCount count={characterCount(draft.title)} limit={TITLE_MAX_CHARACTERS} />
        </Field>

        <Field
          label={words.summary}
          hint={fillPlaceholders(words.summaryHint, { max: String(BLURB_MAX_CHARACTERS) })}
          error={errors.blurb}
        >
          <Textarea
            value={draft.blurb}
            numberOfLines={3}
            disabled={readOnly}
            onChangeText={(blurb) => change('blurb', { ...draft, blurb })}
            onBlur={autosave.flush}
            testID="prelaunch-summary"
          />
          <CharacterCount count={characterCount(draft.blurb)} limit={BLURB_MAX_CHARACTERS} />
        </Field>

        <CoverImageField
          copy={basics.cover}
          cover={draft.coverImage}
          disabled={readOnly}
          error={errors.coverImage}
          onAccept={(coverImage) =>
            change('coverImage', { ...draft, coverImage, coverImageUrl: coverImage.url }, true)
          }
          onRemove={() => change('coverImage', { ...draft, coverImage: null, coverImageUrl: '' }, true)}
        />
      </View>

    </ScrollView>
  );
}

/** The open page: how many are waiting, the link, Copy and Share. */
function OpenCard({
  projectId,
  words,
}: {
  readonly projectId: string;
  readonly words: PrelaunchPanelCopy;
}) {
  const t = useT('mobile.editor.prelaunch');
  const page = usePrelaunchPage(projectId);
  const link = prelaunchLink(projectId);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    setCopyFailed(false);
    let done = false;
    try {
      done = await Clipboard.setStringAsync(link);
    } catch {
      done = false;
    }
    if (!done) {
      setCopied(false);
      setCopyFailed(true);
      return;
    }
    setCopied(true);
    announce(words.copiedAnnouncement);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCopied(false);
    }, COPIED_MS);
  }

  async function share(): Promise<void> {
    setShareFailed(false);
    try {
      // iOS shares the address as a link; Android shares text, so the address is the text.
      await Share.share(Platform.OS === 'ios' ? { url: link } : { message: link });
    } catch {
      setShareFailed(true);
    }
  }

  const count = page.data?.followerCount;

  return (
    <View style={styles.card} testID="prelaunch-open-card">
      <View accessible accessibilityRole="header" testID="prelaunch-open-heading">
        <Subheading>{words.openHeading}</Subheading>
      </View>

      <View style={styles.waiting}>
        <Icon icon={Glyphs.People} size={18} color={colors.textSecondary} />
        {/* Only while a read is actually running: offline it pauses, and a skeleton would never end. */}
        {page.data === undefined && page.fetchStatus === 'fetching' ? (
          <View style={styles.grow}>
            <Skeleton height={14} width="70%" />
          </View>
        ) : typeof count === 'number' ? (
          // One text node, so a screen reader reads the sentence once with the number in it.
          <Body style={styles.grow} testID="prelaunch-waiting">
            {fillNodes(words.waiting[pluralCategory(words.locale, count)], {
              count: <Text style={styles.count}>{formatCount(count, words.locale)}</Text>,
            })}
          </Body>
        ) : (
          <Body style={styles.grow} testID="prelaunch-followers-failed">
            {words.followersFailed}
          </Body>
        )}
      </View>

      <View style={styles.pair}>
        <Caption tone="primary">{words.link}</Caption>
        {/*
          Selectable text rather than an input: read-only, focusable and readable by a screen
          reader, and long-press selects it — the fallback when the clipboard is refused.
        */}
        <View style={styles.link} accessible accessibilityLabel={`${words.link}, ${link}`}>
          <Text selectable style={styles.mono} testID="prelaunch-link">
            {link}
          </Text>
        </View>
        <Caption>{words.linkHint}</Caption>
      </View>

      <View style={styles.actions}>
        <Pill
          label={copied ? words.copied : words.copy}
          accessibilityLabel={copied ? words.copied : t('copyLabel')}
          variant="ghost"
          size="sm"
          iconLeft={copied ? Glyphs.Tick : Glyphs.Copy}
          onPress={() => void copy()}
          testID="prelaunch-copy"
        />
        <Pill
          label={t('share')}
          accessibilityLabel={t('shareLabel')}
          variant="ghost"
          size="sm"
          iconLeft={Glyphs.Share}
          onPress={() => void share()}
          testID="prelaunch-share"
        />
      </View>
      {copyFailed ? (
        <InlineAlert variant="danger" description={t('copyFailed')} testID="prelaunch-copy-failed" />
      ) : null}
      {shareFailed ? (
        <InlineAlert variant="danger" description={t('shareFailed')} testID="prelaunch-share-failed" />
      ) : null}
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.surface1 },
  page: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  form: { gap: spacing[6] },
  pair: { gap: spacing[2] },
  stack: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
  card: {
    gap: spacing[3],
    padding: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  grow: { flex: 1 },
  count: { ...font.semibold, color: colors.textPrimary },
  link: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface3,
  },
  mono: {
    fontFamily: MONO,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
