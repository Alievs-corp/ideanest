import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { orderedQuestions, type BackerSurvey } from '@ideanest/account/surveys';
import { Body, Card, InlineAlert, Meta, Pill, Subheading, Tag, type IconComponent, type TagVariant } from '../../components/ui';
import { queryKeys } from '../../api/queries';
import { Glyphs } from '../../icons';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { spacing } from '../../theme';
import { respondToSurvey } from './api';
import { answersToSend, draftFrom, missingAnswers, surveyKey, type Draft } from './survey-form';
import { SurveyQuestionField } from './survey-question-field';

export interface SurveyCardProps {
  readonly survey: BackerSurvey;
  /** Offline, the answers can still be edited but not sent; nothing is queued. */
  readonly online: boolean;
  readonly onAddress: (pledgeId: string) => void;
}

interface Status {
  readonly key: 'closed' | 'answered' | 'needsAnAnswer';
  readonly variant: TagVariant;
  readonly icon: IconComponent;
}

/** The three tags. Each says in words what its colour says, with a glyph beside it. */
function statusOf(survey: BackerSurvey): Status {
  if (!survey.open) return { key: 'closed', variant: 'default', icon: Glyphs.Lock };
  if (survey.answered) return { key: 'answered', variant: 'success', icon: Glyphs.TickCircle };
  return { key: 'needsAnAnswer', variant: 'warning', icon: Glyphs.Clock };
}

/**
 * One survey and the form that answers it — the web's `SurveyCard`.
 *
 * "Save answers", before and after: a second submission is the same row moving (PM-06). The
 * service's answer replaces this survey in the list's cache, so the persisted copy is what was
 * saved. Required questions are checked here before sending, the error beside the field; the
 * service still enforces them. A closed survey stays readable — fields disabled, no save — so
 * a backer can check what they said.
 */
export function SurveyCard({ survey, online, onAddress }: SurveyCardProps) {
  const t = useT('account.surveys.card');
  const tAll = useT();
  const locale = useLocale();
  const client = useQueryClient();
  // Null while untouched: the answers on screen are the saved ones, whatever the cache holds now.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const values = draft ?? draftFrom(survey);
  const status = statusOf(survey);
  const key = surveyKey(survey);

  async function submit() {
    if (busy || !survey.open || !online) return;

    const blanks = missingAnswers(survey, values);
    if (blanks.length > 0) {
      setMissing(new Set(blanks));
      setSaved(false);
      return;
    }

    setMissing(new Set());
    setFailure(null);
    setBusy(true);
    try {
      const updated = await respondToSurvey(survey, answersToSend(survey, values));
      client.setQueryData<readonly BackerSurvey[]>(queryKeys.surveys(), (list) =>
        list?.map((entry) => (surveyKey(entry) === key ? updated : entry)),
      );
      setDraft(null);
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setFailure(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? cause.problem?.title ?? t('refused'))
          : t('unreachable'),
      );
    } finally {
      setBusy(false);
    }
  }

  const when = [
    survey.respondBy !== null && survey.respondBy !== ''
      ? t('respondBy', { time: formatDateTime(survey.respondBy, locale) })
      : t('noDate'),
    survey.answered && survey.submittedAt !== null
      ? t('answeredOn', { time: formatDateTime(survey.submittedAt, locale) })
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');

  return (
    <Card size="md" testID={`survey-${key}`}>
      <View style={styles.card}>
        <View style={styles.head}>
          <Subheading accessibilityRole="header" style={styles.title}>
            {survey.title}
          </Subheading>
          <Tag label={t(status.key)} variant={status.variant} icon={status.icon} testID={`survey-${key}-status`} />
        </View>
        {survey.message !== null && survey.message !== '' ? <Body>{survey.message}</Body> : null}
        <Meta>{when}</Meta>

        {survey.open ? null : (
          <InlineAlert
            variant="info"
            title={t('closedTitle')}
            description={t('closedBody')}
            politeness="polite"
            testID={`survey-${key}-closed`}
          />
        )}

        {orderedQuestions(survey).map((question) => (
          <SurveyQuestionField
            key={question.id}
            question={question}
            value={values[question.id] ?? []}
            disabled={!survey.open || busy}
            error={missing.has(question.id) ? t('required') : undefined}
            onAddress={() => onAddress(survey.pledgeId)}
            onChange={(value) => {
              setDraft({ ...values, [question.id]: value });
              setSaved(false);
              if (value.length > 0 && missing.has(question.id)) {
                setMissing((previous) => new Set([...previous].filter((id) => id !== question.id)));
              }
            }}
          />
        ))}

        {/* Errors appear at once, never animated in (`mobile-design` §6.4). */}
        {failure === null ? null : (
          <InlineAlert
            variant="danger"
            title={t('failedTitle')}
            description={failure}
            politeness="assertive"
            testID={`survey-${key}-failed`}
          />
        )}
        {saved && failure === null ? (
          <InlineAlert
            variant="success"
            title={t('savedTitle')}
            description={t('savedBody')}
            politeness="polite"
            testID={`survey-${key}-saved`}
          />
        ) : null}

        {survey.open && !online ? (
          <InlineAlert
            variant="warning"
            description={tAll('mobile.surveys.offlineSave')}
            politeness="polite"
            testID={`survey-${key}-offline`}
          />
        ) : null}
        {survey.open ? (
          <View style={styles.start}>
            <Pill
              label={busy ? t('saving') : t('submit')}
              busy={busy}
              disabled={!online}
              onPress={() => void submit()}
              testID={`survey-${key}-save`}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[4] },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[3] },
  title: { flexShrink: 1 },
  start: { alignSelf: 'flex-start' },
});
