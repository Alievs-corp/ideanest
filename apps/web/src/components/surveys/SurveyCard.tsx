'use client';

import { useState, type FormEvent } from 'react';
import { InlineAlert, Pill, Tag } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  answerFor,
  orderedQuestions,
  respondToSurvey,
  type BackerSurvey,
  type SurveyAnswer,
} from '../../lib/surveys/api';
import { formatExactTime } from '../../lib/time';
import { SurveyQuestionField } from './SurveyQuestionField';
import type { SurveyCardCopy } from '../../lib/i18n/surveys-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * One survey, and the form that answers it — §4.8 PM-05 and PM-06. Issue #289.
 *
 * <h2>Answering twice is the same row, and the wording says so</h2>
 *
 * `BackerSurveyController` answers 200 even on a first submission, deliberately: PM-06 makes
 * this one row that moves rather than a new resource each time. So the control reads **Save
 * answers** and not Submit, before and after — a button labelled Submit that can be pressed
 * again is a button somebody is afraid to press.
 *
 * <h2>A closed survey renders read-only rather than disappearing</h2>
 *
 * A creator can close one after they have what they need. Hiding it would leave a backer
 * unable to check what they said about a reward that has not arrived yet; offering a form that
 * will 409 would be worse. The fields are disabled and the reason is on the card.
 *
 * <h2>Required questions are checked here as well as by the service</h2>
 *
 * Not instead of. The service is the enforcement — a client that skipped the check would be
 * refused — and this is the part that stops somebody submitting, waiting, and being told about
 * a question that scrolled off the top of the screen. The message names the question, and
 * focus is not stolen: docs/ui-kit.md §9.2 wants the error beside the field, and the field is
 * where the reader is already looking.
 *
 * <h2>The words arrive as a prop, and one of them is a promise</h2>
 *
 * A client component cannot read the catalogue — issue #84, and `lib/i18n/surveys-copy.ts`
 * carries why. What makes this card more than a translation is `copy.savedBody`: it tells
 * somebody that the creator can see what they have just typed, which is a fact about who reads
 * their answers rather than a hint about the form. A reader who cannot read it is answering
 * without having been told.
 */

export interface SurveyCardProps {
  readonly survey: BackerSurvey;
  readonly copy: SurveyCardCopy;
}

function draftFrom(survey: BackerSurvey): Record<string, readonly string[]> {
  const draft: Record<string, readonly string[]> = {};
  for (const question of survey.questions) draft[question.id] = answerFor(survey, question.id);
  return draft;
}

export function SurveyCard({ survey: initial, copy }: SurveyCardProps) {
  const locale = useRouteLocale();
  const [survey, setSurvey] = useState(initial);
  const [draft, setDraft] = useState<Record<string, readonly string[]>>(() => draftFrom(initial));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const questions = orderedQuestions(survey);
  const addressHref = `/pledges/${encodeURIComponent(survey.pledgeId)}/address`;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !survey.open) return;

    const missing: Record<string, string> = {};
    for (const question of questions) {
      if (!question.required || question.type === 'ADDRESS') continue;
      if ((draft[question.id] ?? []).length === 0) {
        missing[question.id] = copy.required;
      }
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      setSaved(false);
      return;
    }

    setErrors({});
    setFailure(null);
    setBusy(true);

    /*
     * ADDRESS questions are left out of the submission entirely rather than sent empty. They
     * store no answer, and a row of empty values in `survey_answers` would be a record that
     * somebody answered nothing, which is a different claim from having no row at all.
     */
    const answers: SurveyAnswer[] = questions
      .filter((question) => question.type !== 'ADDRESS')
      .map((question) => ({ questionId: question.id, value: draft[question.id] ?? [] }));

    try {
      const updated = await respondToSurvey(survey.surveyId, survey.pledgeId, answers);
      setSurvey(updated);
      setDraft(draftFrom(updated));
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      setFailure(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? cause.problem?.title ?? copy.refused)
          : copy.unreachable,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{survey.title}</h2>
          {survey.message !== null && survey.message !== '' && (
            <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">
              {survey.message}
            </p>
          )}
        </div>

        {/*
          §9.2: colour never carries the meaning on its own. Each tag says what it means in
          words, and the variant is the second signal.
        */}
        {!survey.open ? (
          <Tag variant="default">{copy.closed}</Tag>
        ) : survey.answered ? (
          <Tag variant="success">{copy.answered}</Tag>
        ) : (
          <Tag variant="warning">{copy.needsAnAnswer}</Tag>
        )}
      </header>

      <p className="mt-3 text-sm text-white/40">
        {survey.respondBy !== null && survey.respondBy !== ''
          ? fillPlaceholders(copy.respondBy, { time: formatExactTime(survey.respondBy, locale) })
          : copy.noDate}
        {survey.answered && survey.submittedAt !== null
          ? ` ${fillPlaceholders(copy.answeredOn, {
              time: formatExactTime(survey.submittedAt, locale),
            })}`
          : ''}
      </p>

      {!survey.open && (
        <div className="mt-5">
          <InlineAlert variant="info" title={copy.closedTitle}>
            <p>{copy.closedBody}</p>
          </InlineAlert>
        </div>
      )}

      {failure !== null && (
        <div className="mt-5">
          <InlineAlert variant="danger" title={copy.failedTitle}>
            <p>{failure}</p>
          </InlineAlert>
        </div>
      )}

      {saved && failure === null && (
        <div className="mt-5">
          <InlineAlert variant="success" title={copy.savedTitle}>
            <p>{copy.savedBody}</p>
          </InlineAlert>
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-6">
        {questions.map((question) => (
          <SurveyQuestionField
            key={question.id}
            question={question}
            value={draft[question.id] ?? []}
            disabled={!survey.open || busy}
            error={errors[question.id]}
            addressHref={addressHref}
            copy={copy.question}
            onChange={(value) => {
              setDraft((previous) => ({ ...previous, [question.id]: value }));
              setSaved(false);
            }}
          />
        ))}

        {survey.open && (
          <div>
            <Pill type="submit" disabled={busy}>
              {busy ? copy.saving : copy.submit}
            </Pill>
          </div>
        )}
      </form>
    </section>
  );
}
