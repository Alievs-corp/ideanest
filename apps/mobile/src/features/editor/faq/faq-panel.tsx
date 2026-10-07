import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import type { ProjectFaq } from '@ideanest/campaign-editor/contract';
import { faqPanelCopyFrom, type FaqPanelCopy } from '@ideanest/campaign-editor/copy';
import { MAX_PROJECT_FAQS, describeOrderRefusal } from '@ideanest/campaign-editor/faqs';
import {
  Body,
  Caption,
  CardTitle,
  EmptyState,
  Heading,
  InlineAlert,
  Meta,
  Pill,
  Skeleton,
  SkeletonGroup,
  announce,
} from '../../../components/ui';
import { queryKeys } from '../../../api/queries';
import { Glyphs } from '../../../icons';
import { useT } from '../../../lib/i18n';
import { colors, radius, spacing } from '../../../theme';
import { DeleteDialog } from '../delete-dialog';
import { useEditor } from '../editor-context';
import { inOrder, upsert } from '../list-cache';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';
import { useDescribeFailure } from '../use-describe-failure';
import { ReorderButtons, useReorder, type Reorder } from '../use-reorder';
import { deleteFaq, reorderFaqs, useEditorFaqs } from './api';
import { FaqEditor } from './faq-editor';

/**
 * The FAQ tab — the web's `FaqPanel` (#162): the campaign's questions and answers, in the order
 * the public FAQ tab shows them.
 *
 * <p>No autosave and no `SaveStatus`: each question is saved explicitly in its `FaqEditor`. Delete
 * asks first ('Delete "{question}"?'). The list is capped at fifty, and "+ Add a question" rests at
 * the cap with the reason beside it.
 *
 * <p>Reorder is move up / move down on each row, and the same moves (plus delete) as accessibility
 * actions on the row's text, through `useReorder` — optimistic, `PATCH …/faqs/reorder` with every
 * id once. A refusal shows the service's order again, rereads the list, and explains it:
 * `FAQ_ORDER_INCOMPLETE` names the questions the two lists disagreed about (`describeOrderRefusal`,
 * shared with the web), from the list as it was sent and as it was reread.
 *
 * <p>An answer is cut to two lines in its row, keeping its line breaks; blank lines become
 * paragraphs on the public page.
 *
 * <p>States: the list loading (three 80pt rows), failed with "Try again", offline with nothing
 * cached, empty, at the limit, a row whose request is in the air. Offline the list is shown as last
 * loaded (`projectEditLists`) and nothing can be changed. Motion: none.
 */
export function FaqPanel() {
  const editor = useEditor();
  const { t, locale } = useEditorTranslators();
  const chrome = useEditorChromeCopy();
  const words = useMemo(() => faqPanelCopyFrom(t, locale, chrome.characterCount), [t, locale, chrome.characterCount]);

  if (editor.project === null) {
    return editor.load === 'loading' ? (
      <View style={styles.page}>
        <Rows label={words.loadingLabel} testID="faq-loading" />
      </View>
    ) : null;
  }
  return <Questions words={words} />;
}

const LOADING_ROWS = [0, 1, 2];

function Rows({ label, testID }: { readonly label: string; readonly testID: string }) {
  return (
    <SkeletonGroup label={label} testID={testID}>
      <View style={styles.list}>
        {LOADING_ROWS.map((row) => (
          <Skeleton key={row} height={80} radius="lg" />
        ))}
      </View>
    </SkeletonGroup>
  );
}

function faqId(faq: ProjectFaq): string {
  return faq.id;
}

function Questions({ words }: { readonly words: FaqPanelCopy }) {
  const editor = useEditor();
  const chrome = useEditorChromeCopy();
  const t = useT('mobile.editor.faq');
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const describe = useDescribeFailure();
  const { projectId, readOnly, online } = editor;

  const query = useEditorFaqs(projectId);
  const faqs = useMemo(() => query.data ?? [], [query.data]);
  const ready = query.data !== undefined;

  const [entry, setEntry] = useState<{ open: boolean; session: number; faq: ProjectFaq | null }>({
    open: false,
    session: 0,
    faq: null,
  });
  const [deleting, setDeleting] = useState<ProjectFaq | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The refusal of the last action outside the modal, and the list it was made against. */
  const [failure, setFailure] = useState<{ readonly failure: SaveFailure; readonly against: readonly ProjectFaq[] } | null>(
    null,
  );

  const setFaqs = useCallback(
    (next: (current: readonly ProjectFaq[] | undefined) => readonly ProjectFaq[]) =>
      queryClient.setQueryData<readonly ProjectFaq[]>(queryKeys.editorFaqs(projectId), next),
    [queryClient, projectId],
  );

  const refetch = query.refetch;
  const reorder = useReorder<ProjectFaq>({
    items: faqs,
    idOf: faqId,
    send: (ids) => reorderFaqs(projectId, ids),
    onRefused: (cause) => {
      setFailure({ failure: describe(cause), against: faqs });
      // The optimistic order is now a lie; the stored one is whatever it was. Read it again.
      void refetch();
    },
    onSaved: (ids) => {
      setFailure(null);
      setFaqs((current) => inOrder(current, ids));
    },
    announcement: (faq, position, total) =>
      fillPlaceholders(words.movedAnnouncement, { question: faq.question, position: String(position), total: String(total) }),
    labels: { moveUp: words.moveUpLabel, moveDown: words.moveDownLabel, delete: words.delete },
    onDelete: (faq) => {
      if (!readOnly) setDeleting(faq);
    },
  });

  async function remove(faq: ProjectFaq): Promise<void> {
    setBusyId(faq.id);
    setFailure(null);
    try {
      await deleteFaq(faq.id);
      setFaqs((current) => (current ?? []).filter((one) => one.id !== faq.id));
      setDeleting(null);
      announce(fillPlaceholders(words.deletedAnnouncement, { question: faq.question }));
    } catch (cause) {
      setDeleting(null);
      setFailure({ failure: describe(cause), against: faqs });
    } finally {
      setBusyId(null);
    }
  }

  const open = (faq: ProjectFaq | null) =>
    setEntry((current) => ({ open: true, session: current.session + 1, faq }));

  const full = faqs.length >= MAX_PROJECT_FAQS;
  const listFailed = query.isError && !ready;
  // An entry deleted elsewhere is named only in the list the order was sent with; one added
  // elsewhere only in the list read again. The explanation knows both.
  const known = failure === null ? faqs : [...faqs, ...failure.against.filter((old) => !faqs.some((faq) => faq.id === old.id))];

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing[8] }]}
        testID="faq-panel"
      >
        <View style={styles.sections}>
          <View style={styles.head}>
            <View style={styles.words}>
              <View style={styles.heading} accessible accessibilityRole="header">
                <Heading>{t('heading')}</Heading>
                {ready ? <Meta>{`(${faqs.length})`}</Meta> : null}
              </View>
              <Caption>{t('explanation')}</Caption>
            </View>
            <View style={styles.start}>
              <Pill
                label={words.add}
                iconLeft={Glyphs.Add}
                variant="ghost"
                size="sm"
                disabled={readOnly || !ready || full}
                onPress={() => open(null)}
                testID="faq-add"
              />
            </View>
          </View>

          {full ? (
            <InlineAlert
              variant="info"
              politeness="polite"
              title={words.atLimitTitle}
              description={t('atLimitBody', { max: String(MAX_PROJECT_FAQS) })}
              testID="faq-full"
            />
          ) : null}

          {failure === null ? null : (
            <InlineAlert
              variant="danger"
              title={words.failedTitle}
              description={failure.failure.message}
              testID="faq-failure"
              action={
                failure.failure.code === 'FAQ_ORDER_INCOMPLETE' ? (
                  <Caption testID="faq-order-explanation">{describeOrderRefusal(failure.failure, known, words)}</Caption>
                ) : undefined
              }
            />
          )}

          {listFailed ? (
            <InlineAlert
              variant="danger"
              title={words.questionsFailedTitle}
              description={describe(query.error).message}
              testID="faq-list-failed"
              action={
                <Pill
                  label={chrome.tryAgain}
                  variant="ghost"
                  size="sm"
                  busy={query.isFetching}
                  disabled={!online}
                  onPress={() => void refetch()}
                  testID="faq-retry"
                />
              }
            />
          ) : null}

          {ready ? (
            faqs.length === 0 ? (
              <EmptyState
                title={words.emptyTitle}
                description={words.description}
                testID="faq-empty"
                action={
                  <Pill
                    label={words.addFirst}
                    variant="ghost"
                    size="sm"
                    disabled={readOnly}
                    onPress={() => open(null)}
                    testID="faq-add-first"
                  />
                }
              />
            ) : (
              <View style={styles.list} accessibilityLabel={words.listLabel} accessibilityRole="list">
                {reorder.items.map((faq, index) => (
                  <FaqRow
                    key={faq.id}
                    faq={faq}
                    words={words}
                    position={index + 1}
                    total={reorder.items.length}
                    reorder={reorder}
                    busy={busyId === faq.id}
                    readOnly={readOnly}
                    onEdit={() => open(faq)}
                    onDelete={() => setDeleting(faq)}
                  />
                ))}
              </View>
            )
          ) : listFailed ? null : online ? (
            <Rows label={words.loadingLabel} testID="faq-list-loading" />
          ) : (
            <InlineAlert variant="warning" description={t('nothingCached')} testID="faq-nothing-cached" />
          )}
        </View>
      </ScrollView>

      <FaqEditor
        key={`faq-${entry.session}`}
        visible={entry.open}
        projectId={projectId}
        faq={entry.faq}
        copy={words.entry}
        readOnly={readOnly}
        onClose={() => setEntry((current) => ({ ...current, open: false }))}
        onSaved={(saved) => setFaqs((current) => upsert(current, saved))}
      />

      <DeleteDialog
        open={deleting !== null}
        title={deleting === null ? words.deleteTitle : fillPlaceholders(words.deleteNamed, { question: deleting.question })}
        description={`${words.cannotBeUndone}\n\n${t('deleteBody')}`}
        deleteLabel={words.delete}
        keepLabel={words.keepIt}
        deleting={deleting !== null && busyId === deleting.id}
        onDelete={() => {
          if (deleting !== null) void remove(deleting);
        }}
        onKeep={() => setDeleting(null)}
        testID="faq-delete"
      />
    </>
  );
}

function FaqRow({
  faq,
  words,
  position,
  total,
  reorder,
  busy,
  readOnly,
  onEdit,
  onDelete,
}: {
  readonly faq: ProjectFaq;
  readonly words: FaqPanelCopy;
  readonly position: number;
  readonly total: number;
  readonly reorder: Reorder<ProjectFaq>;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const named = { question: faq.question, position: String(position), total: String(total) };
  const upLabel = fillPlaceholders(words.moveUpLabel, named);
  const downLabel = fillPlaceholders(words.moveDownLabel, named);
  const deleteLabel = fillPlaceholders(words.deleteLabel, { question: faq.question });

  const own = reorder.accessibilityFor(faq);
  const actions = readOnly
    ? []
    : own.accessibilityActions.map((action) => ({
        ...action,
        label: action.name === 'moveUp' ? upLabel : action.name === 'moveDown' ? downLabel : deleteLabel,
      }));
  const onAction = (event: AccessibilityActionEvent) => {
    if (readOnly || busy) return;
    own.onAccessibilityAction(event);
  };

  return (
    <View style={styles.card} testID={`faq-${faq.id}`}>
      <View style={styles.summary} accessible accessibilityActions={actions} onAccessibilityAction={onAction} testID={`faq-${faq.id}-summary`}>
        <CardTitle>{faq.question}</CardTitle>
        {/* Two lines, as text: enough to recognise the entry. The line breaks are kept. */}
        <Body numberOfLines={2} testID={`faq-${faq.id}-answer`}>
          {faq.answer}
        </Body>
      </View>
      <View style={styles.actions}>
        <ReorderButtons
          reorder={reorder}
          id={faq.id}
          upLabel={upLabel}
          downLabel={downLabel}
          disabled={readOnly}
          testID={`faq-${faq.id}-move`}
        />
        <Pill
          label={words.edit}
          accessibilityLabel={fillPlaceholders(words.editLabel, { question: faq.question })}
          variant="ghost"
          size="sm"
          disabled={busy || readOnly}
          onPress={onEdit}
          testID={`faq-${faq.id}-edit`}
        />
        <Pill
          label={words.delete}
          accessibilityLabel={deleteLabel}
          variant="ghost"
          size="sm"
          disabled={busy || readOnly}
          onPress={onDelete}
          testID={`faq-${faq.id}-delete`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.surface1 },
  page: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  sections: { gap: spacing[6] },
  head: { gap: spacing[3] },
  words: { gap: spacing[1] },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
  list: { gap: spacing[3] },
  card: {
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  summary: { gap: spacing[1] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
});
