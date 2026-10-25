import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import type { RevisionCopy } from '@ideanest/campaign-editor/copy';
import { isRevisionField, revisionRefusalOf, revisionView } from '@ideanest/campaign-editor/revision';
import { InlineAlert, Pill } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { discardRevision, fetchProjectEdit, submitRevision } from './api';
import { DeleteDialog } from './delete-dialog';
import { useDescribeFailure } from './use-describe-failure';

/**
 * Where a launched campaign's edit stands, above every editor tab (#562) — the web's
 * `RevisionNotice` (#561), drawn natively.
 *
 * <p>Edits to a launched campaign are held for a moderator, so the creator has to be told what the
 * fields alone do not say: the changes are not public, backers still see the approved version, and
 * what happens next. `revisionView` (shared with the web) reads which of the four situations the
 * project is in; this draws it, and the words are `campaignEditor.revision.*`.
 *
 * <p>Nothing here is lime. Lime says "act now", and an edit waiting in review is neither urgent nor
 * successful: the situation is a title and an icon, never a colour alone.
 *
 * <p>The discard is confirmed in the editor's own `DeleteDialog`, as a deleted reward or question
 * is. The notice never grows past two fifths of the screen: a long moderator's reason or a list of
 * changed sections scrolls inside it, so the tab under it is always reachable, also at the owner's
 * largest system font.
 */
export interface RevisionNoticeProps {
  readonly projectId: string;
  readonly project: ProjectEdit;
  readonly copy: RevisionCopy;
  /** The server's answer to a submit, a discard, or the re-read after a refusal. */
  readonly onProject: (project: ProjectEdit) => void;
  /** After a discard, so the forms take the live values back. */
  readonly onDiscarded: () => void;
  /** True while offline or not yet read from the service: nothing can be sent or discarded. */
  readonly readOnly: boolean;
}

type Busy = 'submit' | 'discard' | null;

/** The share of the window the notice may take before it scrolls. */
const MAX_SHARE = 0.4;

export function RevisionNotice({ projectId, project, copy, onProject, onDiscarded, readOnly }: RevisionNoticeProps) {
  const view = revisionView(project);
  const { height } = useWindowDimensions();
  const describe = useDescribeFailure();
  const rewardsWords = useT('mobile.editor.rewards');
  const [busy, setBusy] = useState<Busy>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const previous = useRef(view.kind);
  const discardRef = useRef<View>(null);

  /*
   * Editing a PENDING revision returns it to DRAFT. The save's answer is what shows it, and the
   * creator was not told, so say so once the kind moves that way.
   */
  useEffect(() => {
    if (previous.current === 'pending' && view.kind === 'draft') setReturned(true);
    else if (view.kind !== 'draft') setReturned(false);
    previous.current = view.kind;
  }, [view.kind]);

  const run = useCallback(
    async (action: Exclude<Busy, null>): Promise<void> => {
      setBusy(action);
      setProblem(null);
      try {
        const saved = action === 'submit' ? await submitRevision(projectId) : await discardRevision(projectId);
        setConfirming(false);
        setReturned(false);
        onProject(saved);
        if (action === 'discard') onDiscarded();
      } catch (cause) {
        setConfirming(false);
        const failure = describe(cause);
        if (failure.code === 'REVISION_NOT_AVAILABLE') {
          setProblem(copy.refusals[revisionRefusalOf(failure.meta)]);
          try {
            onProject(await fetchProjectEdit(projectId));
          } catch {
            // The refusal is already on screen; the next load shows the true state.
          }
        } else {
          setProblem(cause instanceof ApiError ? failure.message : copy.failed);
        }
      } finally {
        setBusy(null);
      }
    },
    [projectId, onProject, onDiscarded, describe, copy],
  );

  if (view.kind === 'none') return null;

  const title =
    view.kind === 'rejected' ? copy.rejectedTitle : view.kind === 'pending' ? copy.pendingTitle : copy.draftTitle;
  const body =
    view.kind === 'rejected' ? copy.rejectedBody : view.kind === 'pending' ? copy.pendingBody : copy.draftBody;
  const working = busy !== null;
  const open = view.kind === 'draft' || view.kind === 'pending';
  // `rewards` is a section of its own in the service's list that the shared copy does not name yet.
  const changed = view.changedFields.map((field) =>
    isRevisionField(field) ? copy.fields[field] : field === 'rewards' ? rewardsWords('revisionField') : field,
  );

  return (
    <ScrollView
      style={[styles.notice, { maxHeight: height * MAX_SHARE }]}
      contentContainerStyle={styles.content}
      testID="revision-notice"
    >
      <InlineAlert
        variant={view.kind === 'rejected' ? 'warning' : 'info'}
        title={title}
        description={body}
        testID={`revision-${view.kind}`}
        action={
          <View style={styles.details}>
            {view.reason === null ? null : (
              <Text style={styles.text} testID="revision-reason">
                <Text style={styles.strong}>{copy.reasonLabel}: </Text>
                {view.reason}
              </Text>
            )}
            {changed.length === 0 ? null : (
              <Text style={styles.text} testID="revision-changed">
                <Text style={styles.strong}>{copy.changedHeading}: </Text>
                {changed.join(', ')}
              </Text>
            )}
            {returned ? (
              <Text
                style={[styles.text, styles.strong]}
                accessibilityLiveRegion="polite"
                testID="revision-returned"
              >
                {copy.returnedToDraft}
              </Text>
            ) : null}
            {open ? (
              <View style={styles.actions}>
                <Pill
                  label={busy === 'submit' ? copy.submitting : copy.submit}
                  fullWidth
                  wrap
                  busy={busy === 'submit'}
                  disabled={readOnly || working || !view.canSubmit}
                  onPress={() => void run('submit')}
                  testID="revision-submit"
                />
                <Pill
                  ref={discardRef}
                  label={copy.discard}
                  variant="ghost"
                  fullWidth
                  wrap
                  disabled={readOnly || working || !view.canDiscard}
                  onPress={() => setConfirming(true)}
                  testID="revision-discard"
                />
              </View>
            ) : null}
          </View>
        }
      />
      {problem === null ? null : (
        <InlineAlert variant="danger" title={copy.refusedTitle} description={problem} testID="revision-refused" />
      )}
      <DeleteDialog
        open={confirming}
        title={copy.confirmDiscardTitle}
        description={copy.confirmDiscardBody}
        deleteLabel={busy === 'discard' ? copy.discarding : copy.confirmDiscard}
        keepLabel={copy.keepEditing}
        deleting={busy === 'discard'}
        onDelete={() => void run('discard')}
        onKeep={() => setConfirming(false)}
        returnFocusTo={discardRef}
        testID="revision-discard-dialog"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notice: { flexGrow: 0, flexShrink: 0 },
  content: { gap: spacing[3], paddingHorizontal: spacing[5], paddingTop: spacing[3] },
  // The alert lays its action out as a row; this is the one column inside it.
  details: { flex: 1, minWidth: 0, gap: spacing[2] },
  text: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: lineHeight.small, ...font.regular },
  strong: { color: colors.textPrimary, ...font.medium },
  actions: { gap: spacing[2], marginTop: spacing[1] },
});
