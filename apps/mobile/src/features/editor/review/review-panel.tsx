import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import {
  describeProgress,
  isChecklistSection,
  isReviewNotedState,
  offersLaunch,
  offersSubmit,
  progressOf,
  unmetOf,
} from '@ideanest/campaign-editor/checklist';
import type { ChecklistItem, ProjectChecklist, ProjectEdit } from '@ideanest/campaign-editor/contract';
import { reviewPanelCopyFrom, type EditorChromeCopy, type ReviewPanelCopy } from '@ideanest/campaign-editor/copy';
import {
  Body,
  Caption,
  Eyebrow,
  Icon,
  InlineAlert,
  MotionBudgetProvider,
  Pill,
  ProgressBar,
  Skeleton,
  SkeletonGroup,
  Subheading,
} from '../../../components/ui';
import { FOCUS_DELAY_MS, focusOn } from '../../../components/ui/overlay';
import { Glyphs } from '../../../icons';
import { formatDate, pluralCategory, useT } from '../../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { useEditor } from '../editor-context';
import { editorTabHref } from '../editor-tabs';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';
import { launchProject, submitProject, useProjectChecklist } from './api';
import { needsSubscription, reviewFailureMessage, submitRefusal, type SubmitRefusal } from './review-failure';

/**
 * The Review tab — the web's `ReviewPanel` (#162): how complete the campaign is, what moderation
 * last said, and the two irreversible buttons, Submit for review and Launch.
 *
 * <p><b>The server is the authority, not this screen.</b> The checklist is
 * `GET /v1/projects/{id}/checklist`, read when the tab opens and on "Check again". Nothing here
 * decides whether the campaign may be submitted: `POST /submit` re-checks, and a refusal is drawn
 * from the requirements the server named. The only client-side lists are the shared presentation
 * decisions `offersSubmit` / `offersLaunch` — whether to draw a button at all.
 *
 * <p><b>Required and recommended differ by more than colour:</b> two headed groups, three icon
 * shapes, and a spoken status on every row. A row not done carries a "Fix in …" pill that replaces
 * the route with that tab.
 *
 * <p><b>A blocked Submit still answers.</b> With required items outstanding it is drawn and
 * announced as disabled (40%, `accessibilityState.disabled`) but pressing it moves screen-reader
 * focus to the "Required before you can submit" heading — what the creator was trying to find out.
 *
 * <p><b>Launch is confirmed inline</b>, not in a dialog: the warning is stated before the second
 * press, and focus moves to "Launch now" so the question cannot be missed by somebody who cannot
 * see it appear.
 *
 * <p>Motion: none, except the one the issue sanctions — the completeness fill, 800ms
 * (`motion.progress`), once, drawn at its figure under Reduce Motion.
 */
export function ReviewPanel() {
  const editor = useEditor();
  const { t, locale } = useEditorTranslators();
  const words = useMemo(() => reviewPanelCopyFrom(t, locale), [t, locale]);
  const chrome = useEditorChromeCopy();
  const checklist = useProjectChecklist(editor.load === 'signed-out' ? '' : editor.projectId);

  const reloadAll = () => {
    editor.reload();
    void checklist.refetch();
  };

  if (editor.project === null) {
    return editor.load === 'loading' ? <Loading label={words.loadingLabel} /> : null;
  }
  if (checklist.data === undefined) {
    if (checklist.isError || !editor.online) {
      return (
        <View style={styles.page} testID="review-failed">
          <InlineAlert
            variant="danger"
            title={words.loadFailedTitle}
            description={checklist.isError ? reviewFailureMessage(checklist.error, words) : words.unreachable}
            action={
              <View style={styles.start}>
                <Pill
                  label={chrome.tryAgain}
                  variant="ghost"
                  size="sm"
                  busy={checklist.isFetching}
                  onPress={reloadAll}
                  testID="review-retry"
                />
              </View>
            }
          />
        </View>
      );
    }
    return <Loading label={words.loadingLabel} />;
  }
  return (
    <Review
      project={editor.project}
      checklist={checklist.data}
      refreshFailed={checklist.isError ? reviewFailureMessage(checklist.error, words) : null}
      words={words}
      reloadAll={reloadAll}
      refetchChecklist={() => void checklist.refetch()}
    />
  );
}

const LOADING_ROWS = [0, 1, 2, 3];

function Loading({ label }: { readonly label: string }) {
  return (
    <View style={styles.page}>
      <SkeletonGroup label={label} testID="review-loading">
        <View style={styles.rows}>
          {LOADING_ROWS.map((row) => (
            <Skeleton key={row} height={40} radius="lg" />
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}

function Review({
  project,
  checklist,
  refreshFailed,
  words,
  reloadAll,
  refetchChecklist,
}: {
  readonly project: ProjectEdit;
  readonly checklist: ProjectChecklist;
  readonly refreshFailed: string | null;
  readonly words: ReviewPanelCopy;
  readonly reloadAll: () => void;
  readonly refetchChecklist: () => void;
}) {
  const editor = useEditor();
  const chrome = useEditorChromeCopy();
  const tReview = useT('mobile.editor.review');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<SubmitRefusal | null>(null);
  const [confirmingLaunch, setConfirmingLaunch] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const requiredHeading = useRef<Text>(null);
  const launchButton = useRef<View>(null);
  const launchNow = useRef<View>(null);
  const returnToLaunch = useRef(false);

  const { projectId, online, apply } = editor;
  // The project's state is the freshest: a submit or a launch applies its answer at once.
  const state = project.state;
  const progress = progressOf(checklist);
  const blockers = unmetOf(checklist.blocking);
  const suggestions = unmetOf(checklist.advisory);
  const held = blockers.length > 0;
  const moderation = checklist.moderation;

  // Focus follows the consequence: the question appeared, so its answer is where focus lands.
  useEffect(() => {
    const target = confirmingLaunch ? launchNow : returnToLaunch.current ? launchButton : null;
    if (target === null) return undefined;
    returnToLaunch.current = false;
    const timer = setTimeout(() => focusOn(target.current), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [confirmingLaunch]);

  function checkAgain(): void {
    setRefusal(null);
    setLaunchError(null);
    reloadAll();
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setRefusal(null);
    try {
      apply(await submitProject(projectId));
      // The state changed, and with it the moderation outcome's `current` flag.
      refetchChecklist();
    } catch (cause) {
      if (needsSubscription(cause)) {
        router.push({ pathname: '/pricing', params: { from: 'submit', project: projectId } });
        return;
      }
      setRefusal(submitRefusal(cause, words));
    } finally {
      setSubmitting(false);
    }
  }

  async function launch(): Promise<void> {
    setLaunching(true);
    setLaunchError(null);
    try {
      apply(await launchProject(projectId));
      setConfirmingLaunch(false);
      refetchChecklist();
    } catch (cause) {
      // The confirmation stays open with the reason under it: closing it would look like nothing
      // happened.
      setLaunchError(reviewFailureMessage(cause, words));
    } finally {
      setLaunching(false);
    }
  }

  const submitExplanation = held
    ? `${fillPlaceholders(words.blockersRemaining[pluralCategory(words.locale, blockers.length)], {
        count: String(blockers.length),
      })} ${suggestions.length > 0 ? words.recommendedNotPartOfThis : words.finishThem}`
    : words.moderatorNote;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing[8] }]}
      testID="review-panel"
    >
      <View style={styles.sections}>
        {refreshFailed === null ? null : (
          <InlineAlert
            variant="danger"
            title={words.loadFailedTitle}
            description={refreshFailed}
            testID="review-refresh-failed"
            action={
              <View style={styles.start}>
                <Pill label={chrome.tryAgain} variant="ghost" size="sm" onPress={checkAgain} />
              </View>
            }
          />
        )}

        {moderation != null && moderation.current && moderation.outcome !== 'APPROVED' ? (
          <InlineAlert
            variant={moderation.outcome === 'REJECTED' ? 'danger' : 'warning'}
            title={moderation.outcome === 'REJECTED' ? words.refusedTitle : words.changesRequestedTitle}
            // A Text keeps the moderator's line breaks as they wrote them.
            description={moderation.note ?? words.noReason}
            // Read where it stands rather than interrupting: it greets every visit to the tab.
            politeness="polite"
            testID="review-moderation"
            action={<Caption testID="review-moderation-date">{formatDate(moderation.decidedAt, words.locale)}</Caption>}
          />
        ) : null}

        {isReviewNotedState(state) ? (
          <InlineAlert
            variant="info"
            title={chrome.states[state]}
            description={words.stateNote[state]}
            testID="review-state-note"
          />
        ) : null}

        {refusal === null ? null : (
          <InlineAlert
            variant="danger"
            title={words.notSubmittedTitle}
            description={refusal.message}
            testID="review-refusal"
            action={
              <View style={styles.stack}>
                {refusal.unmet.map((item) => (
                  <Caption key={item.requirement}>{`${item.label}: ${item.detail}`}</Caption>
                ))}
                <View style={styles.actions}>
                  {refusal.planLimit ? (
                    <Pill
                      label={words.seeOtherPlans}
                      variant="outline"
                      size="sm"
                      onPress={() => router.push('/pricing')}
                      testID="review-plans"
                    />
                  ) : null}
                  <Pill
                    label={words.checkAgain}
                    variant="ghost"
                    size="sm"
                    onPress={checkAgain}
                    testID="review-check-again"
                  />
                </View>
              </View>
            }
          />
        )}

        <View style={styles.stack}>
          <Eyebrow accessibilityRole="header">{words.completeness}</Eyebrow>
          <Body tone="primary" testID="review-progress">
            {describeProgress(progress, words.progressSummary)}
          </Body>
          {/*
            The sentence carries the meaning; the bar is a picture of it, hidden from screen readers.
            The editor's budget is `none`; this fill is the one motion it sanctions (#162).
          */}
          <MotionBudgetProvider level="minimal">
            <ProgressBar
              completionPercent={String(progress.score)}
              label={fillPlaceholders(words.progressLabel, { score: String(progress.score) })}
              size="md"
              showLabel={false}
              decorative
              rise="progress"
              testID="review-progress-bar"
            />
          </MotionBudgetProvider>
        </View>

        <ChecklistSection
          heading={words.requiredHeading}
          headingRef={requiredHeading}
          description={words.requiredDescription}
          items={checklist.blocking}
          tone="blocking"
          words={words}
          tabs={chrome.tabs}
          done={tReview('done')}
          onFix={(section) => {
            editor.autosave.flush();
            router.replace(editorTabHref(projectId, section));
          }}
          testID="review-required"
        />

        <ChecklistSection
          heading={words.recommendedHeading}
          description={words.recommendedDescription}
          items={checklist.advisory}
          tone="advisory"
          words={words}
          tabs={chrome.tabs}
          done={tReview('done')}
          onFix={(section) => {
            editor.autosave.flush();
            router.replace(editorTabHref(projectId, section));
          }}
          testID="review-recommended"
        />

        {offersSubmit(state) ? (
          <View style={styles.stack}>
            <Pill
              label={submitting ? words.submitting : words.submit}
              variant="accent"
              size="lg"
              fullWidth
              busy={submitting}
              disabled={!online}
              softDisabled={held}
              accessibilityHint={submitExplanation}
              onPress={() => {
                if (submitting) return;
                if (held) {
                  focusOn(requiredHeading.current);
                  return;
                }
                void submit();
              }}
              testID="review-submit"
            />
            <Caption testID="review-submit-explanation">{submitExplanation}</Caption>
          </View>
        ) : null}

        {offersLaunch(state) ? (
          <View style={styles.stack}>
            {launchError === null ? null : (
              <InlineAlert
                variant="danger"
                title={words.notLaunchedTitle}
                description={launchError}
                testID="review-launch-failed"
                action={
                  <View style={styles.start}>
                    <Pill label={words.checkAgain} variant="ghost" size="sm" onPress={checkAgain} />
                  </View>
                }
              />
            )}
            {confirmingLaunch ? (
              <View style={styles.confirm} testID="review-launch-confirm">
                <Subheading accessibilityRole="header">{words.confirmLaunchTitle}</Subheading>
                <Caption>{tReview('confirmLaunchBody')}</Caption>
                <View style={styles.actions}>
                  <Pill
                    ref={launchNow}
                    label={launching ? words.launching : words.launchNow}
                    variant="accent"
                    busy={launching}
                    disabled={!online}
                    onPress={() => void launch()}
                    testID="review-launch-now"
                  />
                  <Pill
                    label={words.cancel}
                    variant="ghost"
                    disabled={launching}
                    onPress={() => {
                      returnToLaunch.current = true;
                      setConfirmingLaunch(false);
                    }}
                    testID="review-launch-cancel"
                  />
                </View>
              </View>
            ) : (
              <>
                <Pill
                  ref={launchButton}
                  label={words.launch}
                  variant="accent"
                  size="lg"
                  fullWidth
                  disabled={!online}
                  accessibilityHint={tReview('launchExplanation')}
                  onPress={() => {
                    setLaunchError(null);
                    setConfirmingLaunch(true);
                  }}
                  testID="review-launch"
                />
                <Caption>{tReview('launchExplanation')}</Caption>
              </>
            )}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

type ChecklistTone = 'blocking' | 'advisory';

function ChecklistSection({
  heading,
  headingRef,
  description,
  items,
  tone,
  words,
  tabs,
  done,
  onFix,
  testID,
}: {
  readonly heading: string;
  readonly headingRef?: Ref<Text>;
  readonly description: string;
  readonly items: readonly ChecklistItem[];
  readonly tone: ChecklistTone;
  readonly words: ReviewPanelCopy;
  readonly tabs: EditorChromeCopy['tabs'];
  readonly done: string;
  readonly onFix: (section: 'basics' | 'rewards' | 'story') => void;
  readonly testID: string;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.stack} testID={testID}>
      <Text ref={headingRef} accessibilityRole="header" style={styles.sectionHeading} testID={`${testID}-heading`}>
        {heading}
      </Text>
      <Caption>{description}</Caption>
      <View style={styles.rows}>
        {items.map((item) => (
          <ChecklistRow
            key={item.requirement}
            item={item}
            tone={tone}
            words={words}
            tabs={tabs}
            done={done}
            onFix={onFix}
          />
        ))}
      </View>
    </View>
  );
}

/** Inline icons beside text are 18 (`mobile-design` §5); the fix pill lines up under the words. */
const ROW_ICON_SIZE = 18;

const ROW_ICON = {
  done: { icon: Glyphs.TickCircle, colour: colors.success },
  blocking: { icon: Glyphs.Warning2, colour: colors.danger },
  advisory: { icon: Glyphs.InfoCircle, colour: colors.info },
} as const;

function ChecklistRow({
  item,
  tone,
  words,
  tabs,
  done,
  onFix,
}: {
  readonly item: ChecklistItem;
  readonly tone: ChecklistTone;
  readonly words: ReviewPanelCopy;
  readonly tabs: EditorChromeCopy['tabs'];
  readonly done: string;
  readonly onFix: (section: 'basics' | 'rewards' | 'story') => void;
}) {
  const look = ROW_ICON[item.satisfied ? 'done' : tone];
  // The icon's meaning, said: colour and shape are never the only signal.
  const status = item.satisfied ? done : tone === 'blocking' ? words.requiredNotDone : words.recommendedNotDone;
  const section = !item.satisfied && isChecklistSection(item.section) ? item.section : null;
  const detail = !item.satisfied && item.detail != null && item.detail !== '' ? item.detail : null;

  return (
    <View style={styles.row} testID={`review-row-${item.requirement}`}>
      <View style={styles.rowHead}>
        <Icon icon={look.icon} size={ROW_ICON_SIZE} color={look.colour} />
        <View style={styles.rowText} accessible accessibilityLabel={`${item.label}, ${status}${detail === null ? '' : `. ${detail}`}`}>
          <Body tone="primary">{item.label}</Body>
          {detail === null ? null : <Caption>{detail}</Caption>}
        </View>
      </View>
      {section === null ? null : (
        <View style={styles.fix}>
          <Pill
            label={fillPlaceholders(words.fixIn, { section: tabs[section] })}
            // "Fix in Basics" four times is four indistinguishable buttons; the name says which.
            accessibilityLabel={`${fillPlaceholders(words.fixIn, { section: tabs[section] })}: ${item.label}`}
            variant="ghost"
            size="sm"
            onPress={() => onFix(section)}
            testID={`review-fix-${item.requirement}`}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.surface1 },
  page: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  sections: { gap: spacing[8] },
  stack: { gap: spacing[3] },
  rows: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  sectionHeading: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
  },
  row: {
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  rowText: { flex: 1, gap: spacing[1] },
  fix: { alignSelf: 'flex-start', marginLeft: ROW_ICON_SIZE + spacing[3] },
  confirm: {
    gap: spacing[3],
    padding: spacing[5],
    borderRadius: radius.xl,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
