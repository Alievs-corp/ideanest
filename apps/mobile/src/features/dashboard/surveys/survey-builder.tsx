import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QUESTION_TYPES,
  SURVEY_LIMITS,
  choicesFrom,
  emptyQuestion,
  hasChoices,
  offersRequired,
  questionsLocked,
  withSurvey,
  withType,
  type QuestionType,
  type Survey,
  type SurveyQuestion,
} from '@ideanest/dashboard/surveys';
import { traceIdOfError } from '../../../api/client';
import { queryKeys } from '../../../api/queries';
import { FadeUp, useFirstScreenfulIndex } from '../../../components/motion';
import {
  Body,
  Caption,
  Card,
  CardTitle,
  Checkbox,
  ContentSheet,
  EmptyState,
  Field,
  Heading,
  IconButton,
  InlineAlert,
  Meta,
  Pill,
  Screen,
  Select,
  Skeleton,
  SkeletonGroup,
  Subheading,
  TextInput,
  Textarea,
} from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { useOnline } from '../../../lib/connectivity';
import { signInHrefFor } from '../../../lib/guard';
import { formatCount, pluralCategory, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { useSession } from '../../../lib/use-session';
import { colors, spacing } from '../../../theme';
import {
  createSurvey,
  deleteSurvey,
  listFailure,
  listRewardTiers,
  listSurveys,
  sendSurvey,
  surveyFailure,
  updateSurvey,
} from './api';

/** How long "Send it — this cannot be undone" waits for its second press before standing down. */
export const SEND_CONFIRM_MS = 5_000;

/**
 * One question as the form holds it: the question, the options exactly as typed (a trailing
 * newline is the creator about to type the next option, not an empty one to drop), and a key that
 * survives a question above it being removed.
 */
interface Row {
  readonly key: string;
  readonly question: SurveyQuestion;
  readonly optionsText: string;
}

let rowCount = 0;
function rowOf(question: SurveyQuestion): Row {
  rowCount += 1;
  return { key: question.id ?? `new-${rowCount}`, question, optionsText: question.choices.join('\n') };
}

interface Status {
  readonly text: string;
  readonly failed: boolean;
}

/**
 * `campaigns/[id]/dashboard/surveys` — the web's `SurveyBuilder` (#163, §4.8's PM-01 to PM-04).
 *
 * <h2>Two states, and which one is `sent`</h2>
 *
 * A draft is a form. A sent survey is a record: its questions are read-only (the service refuses
 * a change to them, because a question edited after people answered it changes what they were
 * asked), and only the title and the covering note stay editable.
 *
 * <h2>Sending asks twice</h2>
 *
 * It is the one irreversible control here. The first press relabels the button to say so; the
 * second sends. Any other press, or five seconds, stands it down.
 *
 * <h2>The tiers are read here</h2>
 *
 * "Ask only the backers who chose" needs the campaign's reward tiers, which the web's route never
 * passed (#135). They come from `GET /v1/projects/{id}/rewards`; when they do not load, the picker
 * is hidden with a note and every question asks everybody — everything else still works.
 *
 * <p>The page is a `ScrollView` rather than a virtualised list: a campaign has a handful of
 * surveys, and a recycled cell would drop a half-typed question. Offline, the surveys read this
 * session are shown and every write is disabled.
 */
export function SurveyBuilder({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.dashboardSurveys.signedOutTitle')}
            description={t('mobile.dashboardSurveys.signedOutBody')}
            action={
              <Pill
                label={t('shell.actions.signIn')}
                onPress={() => router.push(signInHrefFor(`/campaigns/${projectId}/dashboard/surveys`))}
              />
            }
          />
        }
      />
    );
  }
  return <Builder projectId={projectId} />;
}

function Builder({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const queryClient = useQueryClient();

  const surveys = useQuery({
    queryKey: queryKeys.dashboardSurveys(projectId),
    queryFn: ({ signal }) => listSurveys(projectId, signal),
  });
  const tiers = useQuery({
    queryKey: queryKeys.dashboardRewardTiers(projectId),
    queryFn: ({ signal }) => listRewardTiers(projectId, signal),
  });

  const [editing, setEditing] = useState<Survey | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<readonly Row[]>(() => [rowOf(emptyQuestion())]);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [busy, setBusy] = useState(false);
  // Taken synchronously by the first press: a second tap in the same frame still sees `busy` as false.
  const inFlight = useRef(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    if (!confirmingSend) return;
    const timer = setTimeout(() => setConfirmingSend(false), SEND_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingSend]);

  const list = surveys.data;
  const entryIndex = useFirstScreenfulIndex((list ?? []).map((survey) => survey.id));
  const locked = questionsLocked(editing);
  const writable = online && !busy;
  const tierList = tiers.data ?? [];

  /** Every press but the second "send" stands the confirmation down. */
  const press =
    <A extends unknown[]>(handler: (...args: A) => void) =>
    (...args: A) => {
      setConfirmingSend(false);
      handler(...args);
    };

  /** Starts one write, or answers false while another is out. */
  function begin(): boolean {
    if (inFlight.current || !online) return false;
    inFlight.current = true;
    setBusy(true);
    setStatus(null);
    return true;
  }

  function finish() {
    inFlight.current = false;
    setBusy(false);
  }

  function store(saved: Survey) {
    queryClient.setQueryData<readonly Survey[]>(queryKeys.dashboardSurveys(projectId), (now) =>
      withSurvey(now ?? [], saved),
    );
  }

  const startNew = press(() => {
    setEditing(null);
    setTitle('');
    setMessage('');
    setRows([rowOf(emptyQuestion())]);
    setStatus(null);
  });

  const startEditing = press((survey: Survey) => {
    setEditing(survey);
    setTitle(survey.title);
    setMessage(survey.message ?? '');
    setRows((survey.questions.length > 0 ? survey.questions : [emptyQuestion()]).map(rowOf));
    setStatus(null);
  });

  const changeRow = (key: string, change: (row: Row) => Row) => {
    setConfirmingSend(false);
    setRows((now) => now.map((row) => (row.key === key ? change(row) : row)));
  };
  const changeQuestion = (key: string, next: Partial<SurveyQuestion>) =>
    changeRow(key, (row) => ({ ...row, question: { ...row.question, ...next } }));

  const save = press(() => {
    if (!begin()) return;
    const draft = { title, message, questions: rows.map((row) => row.question) };
    void (editing === null ? createSurvey(projectId, draft) : updateSurvey(editing.id, draft))
      .then((saved) => {
        store(saved);
        setEditing(saved);
        setStatus({
          text: editing === null ? t('dashboard.surveys.createdNotice') : t('dashboard.surveys.savedNotice'),
          failed: false,
        });
      })
      .catch((cause: unknown) => setStatus({ text: surveyFailure(cause, t), failed: true }))
      .finally(finish);
  });

  const remove = press((survey: Survey) => {
    if (!begin()) return;
    void deleteSurvey(survey.id)
      .then(() => {
        queryClient.setQueryData<readonly Survey[]>(queryKeys.dashboardSurveys(projectId), (now) =>
          (now ?? []).filter((each) => each.id !== survey.id),
        );
        if (editing?.id === survey.id) {
          setEditing(null);
          setTitle('');
          setMessage('');
          setRows([rowOf(emptyQuestion())]);
        }
        setStatus({ text: t('dashboard.surveys.deletedNotice', { title: survey.title }), failed: false });
      })
      .catch((cause: unknown) => setStatus({ text: surveyFailure(cause, t), failed: true }))
      .finally(finish);
  });

  function onSend() {
    if (editing === null || !writable || inFlight.current) return;
    if (!confirmingSend) {
      setConfirmingSend(true);
      return;
    }
    if (!begin()) return;
    setConfirmingSend(false);
    void sendSurvey(editing.id)
      .then((sent) => {
        store(sent);
        setEditing(sent);
        const count = sent.sentTo ?? 0;
        setStatus({
          text: t(`dashboard.surveys.sentNotice.${pluralCategory(locale, count)}`, {
            count: formatCount(count, locale),
          }),
          failed: false,
        });
      })
      .catch((cause: unknown) => setStatus({ text: surveyFailure(cause, t), failed: true }))
      .finally(finish);
  }

  function refresh() {
    setPulling(true);
    void Promise.all([surveys.refetch(), tiers.refetch()]).finally(() => setPulling(false));
  }

  const nothing = list === undefined;
  const unreachable = nothing && !online && !surveys.isFetching;
  const loading = nothing && !surveys.isError && !unreachable;

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{t('dashboard.surveys.heading')}</Heading>
      <Body>{t('dashboard.surveys.intro')}</Body>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        testID="surveys-builder"
        hasContent={!nothing || loading}
        onRefresh={refresh}
        refreshing={pulling}
        offlineNotice={online ? null : t('mobile.dashboardSurveys.offline')}
        error={
          nothing && (surveys.isError || unreachable)
            ? {
                title: t('mobile.dashboardSurveys.failedTitle'),
                description: unreachable ? t('mobile.offline.nothingCached') : listFailure(surveys.error, t),
                onRetry: () => void surveys.refetch(),
                retrying: surveys.isFetching,
                traceId: traceIdOfError(surveys.error),
              }
            : null
        }
      >
        {header}
        <ContentSheet>
          {loading ? (
            <SkeletonGroup label={t('dashboard.surveys.loading')} testID="surveys-loading">
              <View style={styles.stack}>
                <Skeleton height={56} radius="lg" />
                <Skeleton height={56} radius="lg" />
                <Skeleton height={32} width="50%" />
                <Skeleton height={192} radius="lg" />
              </View>
            </SkeletonGroup>
          ) : (
            <View style={styles.stack}>
              {tiers.isError ? (
                <InlineAlert
                  variant="info"
                  description={t('mobile.dashboardSurveys.tiersFailed')}
                  testID="surveys-tiers-failed"
                />
              ) : null}

              {(list ?? []).length === 0 ? (
                <View style={styles.empty} testID="surveys-empty">
                  <CardTitle accessibilityRole="header">{t('mobile.dashboardSurveys.emptyTitle')}</CardTitle>
                  <Body>{t('mobile.dashboardSurveys.emptyBody')}</Body>
                </View>
              ) : (
                <View style={styles.rows}>
                  {(list ?? []).map((survey) => (
                    <FadeUp key={survey.id} index={entryIndex(survey.id)}>
                      <SurveyRow
                        survey={survey}
                        current={editing?.id === survey.id}
                        disabled={!writable}
                        onOpen={() => startEditing(survey)}
                        onDelete={() => remove(survey)}
                      />
                    </FadeUp>
                  ))}
                </View>
              )}

              <View style={styles.form}>
                <Subheading accessibilityRole="header" testID="surveys-form-heading">
                  {editing === null
                    ? t('dashboard.surveys.newHeading')
                    : locked
                      ? t('dashboard.surveys.sentHeading')
                      : t('dashboard.surveys.editHeading')}
                </Subheading>

                <Field label={t('dashboard.surveys.titleLabel')} hint={t('dashboard.surveys.titleHint')} required>
                  <TextInput
                    value={title}
                    onChangeText={(next) => {
                      setConfirmingSend(false);
                      setTitle(next);
                    }}
                    maxLength={SURVEY_LIMITS.title}
                    disabled={!online}
                    testID="survey-title"
                  />
                </Field>

                <Field label={t('dashboard.surveys.noteLabel')} hint={t('dashboard.surveys.noteHint')}>
                  <Textarea
                    value={message}
                    onChangeText={(next) => {
                      setConfirmingSend(false);
                      setMessage(next);
                    }}
                    maxLength={SURVEY_LIMITS.message}
                    disabled={!online}
                    testID="survey-note"
                  />
                </Field>

                <View style={styles.stack} testID="survey-questions">
                  <Subheading accessibilityRole="header">
                    {locked ? t('dashboard.surveys.questionsLegendLocked') : t('dashboard.surveys.questionsLegend')}
                  </Subheading>
                  {rows.map((row, index) => (
                    <QuestionCard
                      key={row.key}
                      row={row}
                      number={index + 1}
                      removable={rows.length > 1}
                      disabled={locked || !online}
                      tiers={tiers.isSuccess ? tierList : null}
                      onChange={(next) => changeQuestion(row.key, next)}
                      onType={(type) =>
                        changeRow(row.key, (now) => {
                          const question = withType(now.question, type);
                          return { ...now, question, optionsText: question.choices.join('\n') };
                        })
                      }
                      onOptions={(text) =>
                        changeRow(row.key, (now) => ({
                          ...now,
                          optionsText: text,
                          question: { ...now.question, choices: choicesFrom(text) },
                        }))
                      }
                      onRemove={press(() => setRows((now) => now.filter((each) => each.key !== row.key)))}
                    />
                  ))}
                  <View style={styles.start}>
                    <Pill
                      variant="outline"
                      iconLeft={Glyphs.Add}
                      label={t('dashboard.surveys.addQuestion')}
                      onPress={press(() => setRows((now) => [...now, rowOf(emptyQuestion())]))}
                      disabled={locked || !online}
                      testID="survey-add-question"
                    />
                  </View>
                </View>

                <View style={styles.buttons}>
                  <Pill
                    variant="accent"
                    label={editing === null ? t('dashboard.surveys.createDraft') : t('dashboard.surveys.save')}
                    onPress={save}
                    disabled={!writable}
                    busy={busy && !confirmingSend}
                    testID="survey-save"
                  />
                  {editing !== null && !locked ? (
                    <Pill
                      variant="outline"
                      iconLeft={Glyphs.Send2}
                      label={confirmingSend ? t('dashboard.surveys.confirmSend') : t('dashboard.surveys.send')}
                      onPress={onSend}
                      disabled={!writable}
                      testID="survey-send"
                    />
                  ) : null}
                  {editing !== null ? (
                    <Pill
                      variant="ghost"
                      label={t('dashboard.surveys.startNew')}
                      onPress={startNew}
                      testID="survey-start-new"
                    />
                  ) : null}
                </View>

                {status === null ? null : status.failed ? (
                  <InlineAlert variant="danger" description={status.text} testID="survey-status" />
                ) : (
                  <InlineAlert variant="success" politeness="polite" description={status.text} testID="survey-status" />
                )}
              </View>
            </View>
          )}
        </ContentSheet>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function SurveyRow({
  survey,
  current,
  disabled,
  onOpen,
  onDelete,
}: {
  readonly survey: Survey;
  readonly current: boolean;
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const summary = survey.sent
    ? t('dashboard.surveys.sentSummary', {
        count: formatCount(survey.sentTo ?? 0, locale),
        answered: formatCount(survey.responseCount, locale),
      })
    : t('dashboard.surveys.draft');
  return (
    <View style={styles.row} testID={`survey-row-${survey.id}`}>
      <View style={styles.rowMain}>
        <Card
          size="sm"
          onPress={onOpen}
          selected={current}
          accessibilityLabel={`${survey.title}, ${summary}`}
          testID={`survey-open-${survey.id}`}
        >
          <View style={styles.rowText}>
            <CardTitle numberOfLines={2}>{survey.title}</CardTitle>
            <Meta>{summary}</Meta>
          </View>
        </Card>
      </View>
      {survey.sent ? null : (
        <IconButton
          icon={Glyphs.Trash}
          variant="ghost"
          label={t('dashboard.surveys.deleteDraft', { title: survey.title })}
          onPress={onDelete}
          disabled={disabled}
          testID={`survey-delete-${survey.id}`}
        />
      )}
    </View>
  );
}

function QuestionCard({
  row,
  number,
  removable,
  disabled,
  tiers,
  onChange,
  onType,
  onOptions,
  onRemove,
}: {
  readonly row: Row;
  readonly number: number;
  readonly removable: boolean;
  readonly disabled: boolean;
  /** The campaign's tiers, or null when they did not load — the picker is then hidden. */
  readonly tiers: readonly { readonly id: string; readonly title: string }[] | null;
  readonly onChange: (next: Partial<SurveyQuestion>) => void;
  readonly onType: (type: QuestionType) => void;
  readonly onOptions: (text: string) => void;
  readonly onRemove: () => void;
}) {
  const t = useT();
  const { question } = row;
  const testID = `survey-question-${number}`;
  return (
    <Card size="sm" testID={testID}>
      <View style={styles.question}>
        <Field label={t('dashboard.surveys.question', { number: String(number) })}>
          <TextInput
            value={question.prompt}
            onChangeText={(prompt) => onChange({ prompt })}
            maxLength={SURVEY_LIMITS.prompt}
            disabled={disabled}
            testID={`${testID}-prompt`}
          />
        </Field>

        <Field label={t('dashboard.surveys.typeLabel')}>
          <Select
            options={QUESTION_TYPES.map((type) => ({ value: type, label: t(`dashboard.surveys.types.${type}`) }))}
            value={question.type}
            onChange={(type) => onType(type as QuestionType)}
            disabled={disabled}
            testID={`${testID}-type`}
          />
        </Field>

        {hasChoices(question.type) ? (
          <Field label={t('dashboard.surveys.optionsLabel')} hint={t('dashboard.surveys.optionsHint')}>
            <Textarea
              value={row.optionsText}
              onChangeText={onOptions}
              disabled={disabled}
              testID={`${testID}-options`}
            />
          </Field>
        ) : null}

        {offersRequired(question.type) ? (
          <Checkbox
            label={t('dashboard.surveys.required')}
            checked={question.required}
            onChange={(required) => onChange({ required })}
            disabled={disabled}
            testID={`${testID}-required`}
          />
        ) : (
          <Caption testID={`${testID}-address`}>{t('dashboard.surveys.addressNote')}</Caption>
        )}

        {tiers !== null && tiers.length > 0 ? (
          <Field label={t('dashboard.surveys.tierLabel')} hint={t('dashboard.surveys.tierHint')}>
            <Select
              options={[
                { value: '', label: t('dashboard.surveys.everybody') },
                ...tiers.map((tier) => ({ value: tier.id, label: tier.title })),
              ]}
              value={question.rewardTierId}
              onChange={(rewardTierId) => onChange({ rewardTierId })}
              disabled={disabled}
              testID={`${testID}-tier`}
            />
          </Field>
        ) : null}

        {removable ? (
          <View style={styles.start}>
            <Pill
              size="sm"
              variant="ghost"
              label={t('dashboard.surveys.removeQuestion')}
              onPress={onRemove}
              disabled={disabled}
              testID={`${testID}-remove`}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  header: { gap: spacing[2], paddingTop: spacing[4], paddingBottom: spacing[6] },
  stack: { gap: spacing[4] },
  rows: { gap: spacing[3] },
  empty: { gap: spacing[2] },
  form: { gap: spacing[5], paddingTop: spacing[4] },
  question: { gap: spacing[4] },
  start: { flexDirection: 'row' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowMain: { flex: 1 },
  rowText: { gap: spacing[1] },
});
