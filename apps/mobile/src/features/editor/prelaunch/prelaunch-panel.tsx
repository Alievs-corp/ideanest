import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
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
import { queryKeys, usePrelaunchPage } from '../../../api/queries';
import {
  Body,
  Caption,
  CharacterCount,
  Dialog,
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
import { describeSaveFailure } from '../save-failure';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';
import { openPrelaunch, prelaunchLink } from './api';

/**
 * The Pre-launch tab — the web's `PrelaunchPanel` (#162): what the pre-launch page will say, the
 * link to share, how many people are waiting, and the control that makes it public.
 *
 * <p><b>The content is the Basics, on purpose.</b> Title, summary and cover are the same fields as
 * the Basics tab's, on the editor's ONE shared autosave (`useEditor().autosave`): each change
 * queues its single-field patch (`patchForField`), sent 800ms after the last change or at once on
 * blur. A pre-launch page that promised something different from the campaign would promise it to
 * the people most likely to notice.
 *
 * <p><b>Opening the page is not an autosave.</b> It publishes the title, summary and cover to
 * anybody with the link, and there is no way back (§6.1), so it is a button behind the kit's white
 * dialog. Confirming flushes the autosave and waits for it to settle before
 * `POST /v1/projects/{id}/prelaunch`: the page publishes whatever the server holds, and a summary
 * typed a second ago must be there first. A change the server refused stops the opening with that
 * refusal rather than publishing the older text.
 *
 * <p>While the page is open (PRELAUNCH or SCHEDULED), the follower count is read from the public
 * `GET /v1/projects/{id}/prelaunch` — the app's own pre-launch screen's reader — and a count that
 * could not be read says so instead of drawing a zero nobody said. The link copies (announced) and
 * opens the share sheet.
 *
 * <p>Motion: none (the editor's budget). Offline, the fields and the buttons are disabled.
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

/** The states in which a pre-launch page exists and collects followers. */
const COLLECTING: readonly ProjectState[] = ['PRELAUNCH', 'SCHEDULED'];

/** How long "Copied" stays on the button, as on the web. */
export const COPIED_MS = 2000;

/** Opening: asked, waiting for the autosave to settle, then the request itself. */
type Opening = 'idle' | 'settling' | 'sending';

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
  const failures = useT('mobile.editor.failures');
  // The dialog's reassurance: the web's literal paragraph, from the catalogue here.
  const tPrelaunch = useT('mobile.editor.prelaunch');
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
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
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState<Opening>('idle');
  /** Why the page did not open; `fromSave` when an autosave refusal stopped it. */
  const [openFailure, setOpenFailure] = useState<{ message: string; fromSave: boolean } | null>(null);
  const openButton = useRef<View>(null);
  const openHeading = useRef<View>(null);
  /** Set once the page has opened: the dialog then hands focus to the open card's heading. */
  const opened = useRef(false);
  /** Bumped by Cancel, so an answer that arrives after it is not acted on as if still awaited. */
  const attempt = useRef(0);
  /** The failure on screen when the opening began, which a retry clears and must not stop it. */
  const failureAtStart = useRef<unknown>(null);
  const returnFocus = useMemo(
    () => ({
      get current(): unknown {
        return opened.current ? openHeading.current : openButton.current;
      },
    }),
    [],
  );

  const { autosave, readOnly, projectId, apply } = editor;
  const project = editor.project ?? seed;
  const canOpen = project.state === 'DRAFT';
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

  function confirmOpen(): void {
    if (readOnly || opening !== 'idle' || refusedHere) return;
    setOpenFailure(null);
    setOpening('settling');
    failureAtStart.current = autosave.failure;
    // Anything still queued goes first; the effect below waits for its answer. A change that
    // failed earlier is sent again rather than taken as this opening's answer.
    if (autosave.failure !== null) autosave.retry();
    else autosave.flush();
  }

  /** Cancel, even mid-request: stop waiting. An answer that still arrives is the truth and is applied. */
  function abandon(): void {
    attempt.current += 1;
    setOpening('idle');
    setConfirming(false);
  }

  /*
   * The opening waits for the autosave: nothing pending means the server holds what is on screen.
   * A refused change stops it — the page would otherwise publish the text before it.
   */
  const { pending, failure } = autosave;
  useEffect(() => {
    if (opening !== 'settling') return;
    if (failure !== null && failure !== failureAtStart.current) {
      setOpening('idle');
      setConfirming(false);
      setOpenFailure({ message: failure.message, fromSave: true });
      return;
    }
    if (pending) return;
    setOpening('sending');
    const mine = attempt.current;
    void (async () => {
      try {
        const answer = await openPrelaunch(projectId);
        // Applied even after Cancel: the server opened the page, and the screen must say so.
        apply(answer);
        // The public page exists now; a read made before it did must not be kept.
        void queryClient.invalidateQueries({ queryKey: queryKeys.prelaunch(projectId) });
        if (mine !== attempt.current) return;
        opened.current = true;
        announce(words.openHeading);
        setConfirming(false);
        setOpening('idle');
      } catch (cause) {
        if (mine !== attempt.current) return;
        setConfirming(false);
        setOpening('idle');
        setOpenFailure({
          fromSave: false,
          message: describeSaveFailure(cause, {
            signedOut: failures('signedOut'),
            forbidden: failures('forbidden'),
            notFound: failures('notFound'),
            conflict: failures('conflict'),
            rejected: failures('rejected'),
            generic: failures('generic'),
            unreachable: failures('unreachable'),
          }).message,
        });
      }
    })();
  }, [opening, pending, failure, apply, projectId, queryClient, failures, words.openHeading]);

  // An opening stopped by a refused change stops being the news once that change is saved.
  useEffect(() => {
    if (openFailure?.fromSave === true && failure === null && !pending) setOpenFailure(null);
  }, [openFailure, failure, pending]);

  const errors: BasicsErrors = {
    ...validateBasics(draft, basics.validation),
    ...basicsServerErrors(failure),
  };
  /*
   * A field the phone refused (an empty or too-long title, a summary over 135, a cover it would
   * not take) was never sent, so the server still holds the older text, and opening publishes
   * what the server holds. The page waits until what is on screen is what would be published.
   */
  const refusedHere =
    errors.title !== undefined ||
    errors.blurb !== undefined ||
    errors.coverImage !== undefined ||
    localOnly.current.size > 0;
  const busy = opening !== 'idle';

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

        {canOpen ? (
          <View style={styles.card} testID="prelaunch-draft">
            <Subheading accessibilityRole="header">{words.notOpenHeading}</Subheading>
            <Body>{words.notOpenBody}</Body>
            <Body>{words.notOpenIrreversible}</Body>
            {openFailure === null ? null : (
              <InlineAlert
                variant="danger"
                title={words.openFailedTitle}
                description={openFailure.message}
                testID="prelaunch-open-failed"
              />
            )}
            <View style={styles.start}>
              <Pill
                ref={openButton}
                label={words.open}
                disabled={readOnly}
                onPress={() => setConfirming(true)}
                testID="prelaunch-open"
              />
            </View>
          </View>
        ) : collecting ? (
          <OpenCard projectId={projectId} words={words} headingRef={openHeading} />
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

      <Dialog
        open={confirming}
        // Android back and the iOS escape gesture are a Cancel, and a Cancel stops waiting.
        onClose={abandon}
        title={words.confirmTitle}
        description={words.confirmBody}
        showClose={false}
        dismissOnScrim={!busy}
        returnFocusTo={returnFocus}
        testID="prelaunch-confirm"
        footer={
          <>
            <Pill
              label={busy ? words.opening : words.confirmOpen}
              fullWidth
              busy={busy}
              disabled={busy || readOnly || refusedHere}
              onPress={confirmOpen}
              testID="prelaunch-confirm-open"
            />
            <Pill
              label={words.cancel}
              variant="ghost"
              fullWidth
              onPress={abandon}
              testID="prelaunch-confirm-cancel"
            />
          </>
        }
      >
        <Body>{tPrelaunch('confirmDetail')}</Body>
        {refusedHere ? (
          <InlineAlert variant="warning" description={tPrelaunch('fixFirst')} testID="prelaunch-fix-first" />
        ) : null}
      </Dialog>
    </ScrollView>
  );
}

/** The open page: how many are waiting, the link, Copy and Share. */
function OpenCard({
  projectId,
  words,
  headingRef,
}: {
  readonly projectId: string;
  readonly words: PrelaunchPanelCopy;
  readonly headingRef: Ref<View>;
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
      <View ref={headingRef} accessible accessibilityRole="header" testID="prelaunch-open-heading">
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
