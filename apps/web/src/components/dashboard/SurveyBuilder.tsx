'use client';

import { useEffect, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import {
  Checkbox,
  Field,
  InlineAlert,
  Select,
  Skeleton,
  SkeletonGroup,
  TextInput,
  Textarea,
} from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  QUESTION_TYPES,
  createSurvey,
  deleteSurvey,
  emptyQuestion,
  hasChoices,
  listSurveys,
  sendSurvey,
  updateSurvey,
  type QuestionType,
  type Survey,
  type SurveyQuestion,
} from '../../lib/dashboard/surveys';
import type { SurveyBuilderCopy } from '../../lib/i18n/dashboard-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * §4.8's PM-01 to PM-04: the survey builder.
 *
 * <h2>The screen is two states, and which one you are in is `sent`</h2>
 *
 * A draft is a form. A sent survey is a record: its questions are read-only, and the only
 * controls left are the covering note and the deadline. That is not a presentation choice
 * — the service refuses a change to a sent survey's questions, because a question edited
 * after four hundred people answered it changes what they were asked without changing what
 * they said. The builder disables the controls so a creator is not offered an edit that is
 * known to be refused; the refusal is still what holds.
 *
 * <h2>PM-02 is a `<select>`, not a rule builder</h2>
 *
 * "Ask this only of the people who chose that tier" is what creators actually want, and it
 * is one column on the row. A question that applies to two tiers is two questions — more
 * typing, and legible on the response export in a way an OR-list is not.
 *
 * <h2>Sending is the one irreversible control on the dashboard</h2>
 *
 * So it asks. Not a modal — `docs/motion-system.md` §5 gives this surface the smallest
 * budget but one, and a dialog here is a dialog that animates — but a second press, with
 * the button relabelled to say what it will do and how many people it will reach.
 *
 * <h2>Motion</h2>
 *
 * None. The loading state is a skeleton, which is the one animation that budget sanctions,
 * and it comes from `@ideanest/ui` rather than `@ideanest/ui/motion` — the animated
 * exports carry 116 kB of runtime this route has no use for.
 */

type Status = 'loading' | 'ready' | 'failed';

/** What a refusal means, branched on status rather than on the service's prose. */
function messageFor(cause: unknown, copy: SurveyBuilderCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.failures.signedOut;
    if (cause.status === 403) return copy.notGranted;
    if (cause.status === 404) return copy.failures.noCampaign;
    if (cause.status === 409) return copy.alreadySent;
    // The service's own `detail` where it sent one: it names the field, which this cannot.
    // §21.1's service copy is per-language too, keyed off the account's own locale.
    if (cause.status === 422) return cause.problem?.detail ?? copy.needsQuestion;
    if (cause.status === 400) return cause.problem?.detail ?? copy.invalid;
  }
  return copy.unavailable;
}

export interface SurveyBuilderProps {
  readonly projectId: string;
  /** The campaign's reward tiers, for PM-02's condition. Empty is legitimate. */
  readonly rewardTiers?: readonly { readonly id: string; readonly title: string }[];
  /** Injected by tests. Default to the real readers and writers. */
  readonly load?: typeof listSurveys;
  readonly create?: typeof createSurvey;
  readonly update?: typeof updateSurvey;
  readonly remove?: typeof deleteSurvey;
  readonly send?: typeof sendSurvey;
  /** Every word this builder draws, the five answer types included — #79. */
  readonly copy: SurveyBuilderCopy;
}

export function SurveyBuilder({
  projectId,
  rewardTiers = [],
  load,
  create,
  update,
  remove,
  send,
  copy,
}: SurveyBuilderProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [surveys, setSurveys] = useState<readonly Survey[]>([]);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Survey | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [questions, setQuestions] = useState<readonly SurveyQuestion[]>([emptyQuestion()]);
  const [confirmingSend, setConfirmingSend] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');

    (load ?? listSurveys)(projectId, controller.signal)
      .then((body) => {
        setSurveys(body);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFailure(messageFor(cause, copy));
        setStatus('failed');
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const startNew = () => {
    setEditing(null);
    setTitle('');
    setMessage('');
    setQuestions([emptyQuestion()]);
    setConfirmingSend(false);
    setNotice('');
  };

  const startEditing = (survey: Survey) => {
    setEditing(survey);
    setTitle(survey.title);
    setMessage(survey.message ?? '');
    setQuestions(survey.questions.length > 0 ? survey.questions : [emptyQuestion()]);
    setConfirmingSend(false);
    setNotice('');
  };

  const changeQuestion = (index: number, next: Partial<SurveyQuestion>) => {
    setQuestions(questions.map((question, at) => (at === index ? { ...question, ...next } : question)));
  };

  const changeType = (index: number, type: QuestionType) => {
    // The options are cleared when the type stops having any, rather than kept and
    // hidden: the service refuses options on a type that has none, and a hidden value
    // that causes a refusal is one a creator cannot see to remove.
    // `noUncheckedIndexedAccess` is on, and correctly: the index comes from a map over
    // this very array, so it is present, and saying so once here is cheaper than a
    // non-null assertion at each use.
    const current = questions[index];
    if (!current) return;
    changeQuestion(index, { type, choices: hasChoices(type) ? current.choices : [] });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const body = { title, message, questions };
      const saved = editing
        ? await (update ?? updateSurvey)(editing.id, body)
        : await (create ?? createSurvey)(projectId, body);

      setSurveys([saved, ...surveys.filter((survey) => survey.id !== saved.id)]);
      setEditing(saved);
      setNotice(editing ? copy.savedNotice : copy.createdNotice);
    } catch (cause) {
      setNotice(messageFor(cause, copy));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (survey: Survey) => {
    setBusy(true);
    try {
      await (remove ?? deleteSurvey)(survey.id);
      setSurveys(surveys.filter((each) => each.id !== survey.id));
      if (editing?.id === survey.id) startNew();
      setNotice(fillPlaceholders(copy.deletedNotice, { title: survey.title }));
    } catch (cause) {
      setNotice(messageFor(cause, copy));
    } finally {
      setBusy(false);
    }
  };

  const onSend = async () => {
    if (!editing) return;
    if (!confirmingSend) {
      setConfirmingSend(true);
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const sent = await (send ?? sendSurvey)(editing.id);
      setSurveys([sent, ...surveys.filter((survey) => survey.id !== sent.id)]);
      setEditing(sent);
      setConfirmingSend(false);
      setNotice(pluralise(locale, copy.sentNotice, sent.sentTo ?? 0));
    } catch (cause) {
      setNotice(messageFor(cause, copy));
      setConfirmingSend(false);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-32 w-full" />
      </SkeletonGroup>
    );
  }

  if (status === 'failed') {
    return <InlineAlert variant="danger">{failure}</InlineAlert>;
  }

  const locked = editing?.sent ?? false;

  return (
    <section aria-labelledby="surveys-heading">
      <h1 id="surveys-heading" className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
        {copy.heading}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.intro}</p>

      {surveys.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {surveys.map((survey) => (
            <li
              key={survey.id}
              className="flex flex-wrap items-center gap-3 rounded-[12px] border border-white/8 px-4 py-3"
            >
              <button
                type="button"
                onClick={() => startEditing(survey)}
                aria-current={editing?.id === survey.id ? 'true' : undefined}
                className="text-left text-sm font-medium text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
              >
                {survey.title}
              </button>
              {/* ui-kit §9.2: colour alone never carries meaning, so the state is a word. */}
              <span className="text-xs text-white/64">
                {survey.sent
                  ? fillPlaceholders(copy.sentSummary, {
                      count: String(survey.sentTo ?? 0),
                      answered: String(survey.responseCount),
                    })
                  : copy.draft}
              </span>
              {survey.sent ? null : (
                <button
                  type="button"
                  onClick={() => onDelete(survey)}
                  disabled={busy}
                  aria-label={fillPlaceholders(copy.deleteDraft, { title: survey.title })}
                  className="ml-auto rounded-full p-1 text-white/64 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        <h2 className="text-lg font-semibold text-white">
          {editing ? (locked ? copy.sentHeading : copy.editHeading) : copy.newHeading}
        </h2>

        <Field label={copy.titleLabel} hint={copy.titleHint}>
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} required />
        </Field>

        <Field label={copy.noteLabel} hint={copy.noteHint}>
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={3} />
        </Field>

        <fieldset disabled={locked} className="flex flex-col gap-5">
          {/* One legend or the other, never a sentence built by concatenation: where the
              clause falls is what a translation is entitled to change. */}
          <legend className="text-sm font-medium text-white">
            {locked ? copy.questionsLegendLocked : copy.questionsLegend}
          </legend>

          {questions.map((question, index) => (
            <div key={question.id ?? `new-${index}`} className="flex flex-col gap-3 rounded-[12px] border border-white/8 p-4">
              <Field label={fillPlaceholders(copy.question, { number: String(index + 1) })}>
                <TextInput
                  value={question.prompt}
                  onChange={(event) => changeQuestion(index, { prompt: event.target.value })}
                  maxLength={300}
                />
              </Field>

              <Field label={copy.typeLabel}>
                <Select
                  value={question.type}
                  onChange={(event) => changeType(index, event.target.value as QuestionType)}
                >
                  {QUESTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {copy.types[type]}
                    </option>
                  ))}
                </Select>
              </Field>

              {hasChoices(question.type) ? (
                <Field label={copy.optionsLabel} hint={copy.optionsHint}>
                  <Textarea
                    value={question.choices.join('\n')}
                    onChange={(event) =>
                      changeQuestion(index, {
                        choices: event.target.value.split('\n').map((choice) => choice.trim()).filter(Boolean),
                      })
                    }
                    rows={4}
                  />
                </Field>
              ) : null}

              {question.type === 'ADDRESS' ? (
                <p className="text-xs text-white/64">{copy.addressNote}</p>
              ) : (
                <Checkbox
                  checked={question.required}
                  onChange={(event) => changeQuestion(index, { required: event.currentTarget.checked })}
                  label={copy.required}
                />
              )}

              {rewardTiers.length > 0 ? (
                <Field label={copy.tierLabel} hint={copy.tierHint}>
                  <Select
                    value={question.rewardTierId}
                    onChange={(event) => changeQuestion(index, { rewardTierId: event.target.value })}
                  >
                    <option value="">{copy.everybody}</option>
                    {rewardTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {questions.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setQuestions(questions.filter((_, at) => at !== index))}
                  className="self-start text-sm text-white/64 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
                >
                  {copy.removeQuestion}
                </button>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setQuestions([...questions, emptyQuestion()])}
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/16 px-4 py-2.5 text-sm font-medium text-white hover:bg-[--surface-3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
          >
            <Plus className="size-4" aria-hidden />
            {copy.addQuestion}
          </button>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-[--lime-500] px-5 py-2.5 text-sm font-semibold text-[--ink-900] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {editing ? copy.save : copy.createDraft}
          </button>

          {editing && !locked ? (
            <button
              type="button"
              onClick={onSend}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-white/16 px-4 py-2.5 text-sm font-medium text-white hover:bg-[--surface-3] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
            >
              <Send className="size-4" aria-hidden />
              {confirmingSend ? copy.confirmSend : copy.send}
            </button>
          ) : null}

          {editing ? (
            <button
              type="button"
              onClick={startNew}
              className="text-sm text-white/64 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
            >
              {copy.startNew}
            </button>
          ) : null}
        </div>

        {notice ? (
          // Polite rather than assertive: a save confirmation is not an interruption, and
          // ui-kit §9 asks that a status message reach a screen reader without stealing
          // focus from the control that produced it.
          <p role="status" className="text-sm text-white/64">
            {notice}
          </p>
        ) : null}
      </form>
    </section>
  );
}
