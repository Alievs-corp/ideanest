'use client';

import { Link } from '../../i18n/navigation';
import { Checkbox, Field, Radio, RadioGroup, TextInput, Textarea } from '@ideanest/ui';
import type { SurveyQuestion } from '../../lib/surveys/api';
import type { SurveyQuestionCopy } from '../../lib/i18n/surveys-copy';

/**
 * One question, drawn as whatever its type is — §4.8 PM-05.
 *
 * <h2>Five types, and the fifth is not a field</h2>
 *
 * `QuestionType.ADDRESS` is the one that stores no answer. Its own comment gives the reason:
 * the answer is the pledge's row in `shipping_addresses` — encrypted at rest, validated, and
 * lockable by the creator — and copying it into `survey_answers` "would give the platform two
 * addresses per backer that can disagree, in a table with none of that machinery", somewhere
 * §17.4's erasure does not know to look.
 *
 * So an ADDRESS question renders as a prompt with a link to the address form (#290) and
 * contributes nothing to the submission. V35 refuses to let it be marked required, which is
 * why nothing here has to handle a required address.
 *
 * <h2>An unknown type renders as text rather than disappearing</h2>
 *
 * A newer service could add a sixth. Falling through to a text field means an answer that
 * reaches the right question with the wrong control; dropping the question means a backer who
 * cannot see what they are being asked and a creator who never finds out why. The first is
 * recoverable and the second is silent.
 *
 * <h2>The question is the creator's words; everything around it is the catalogue's</h2>
 *
 * A prompt, its help text and its choices were typed by a creator in whatever language they
 * campaign in, and nothing here translates them. The two sentences this component supplies
 * itself — why an address is not asked for here, and where it is asked for instead — come from
 * the catalogue like every other word on the screen (issue #84).
 */

export interface SurveyQuestionFieldProps {
  readonly question: SurveyQuestion;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  /** Where an ADDRESS question sends somebody. */
  readonly addressHref: string;
  readonly copy: SurveyQuestionCopy;
}

export function SurveyQuestionField({
  question,
  value,
  onChange,
  disabled,
  error,
  addressHref,
  copy,
}: SurveyQuestionFieldProps) {
  const hint = question.helpText ?? undefined;
  const single = value[0] ?? '';

  if (question.type === 'ADDRESS') {
    return (
      <div className="rounded-xl border border-white/8 bg-surface-1 p-5">
        <p className="text-[15px] font-medium text-white">{question.prompt}</p>
        {hint !== undefined && <p className="mt-1 text-sm text-white/64">{hint}</p>}
        <p className="mt-3 text-sm text-white/40">{copy.addressNote}</p>
        <Link
          href={addressHref}
          className="mt-3 inline-block rounded-sm text-[15px] text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {copy.addressLink}
        </Link>
      </div>
    );
  }

  if (question.type === 'CHOICE') {
    return (
      <Field label={question.prompt} hint={hint} error={error} required={question.required} grouped>
        <RadioGroup
          value={single}
          onValueChange={(next) => onChange([next])}
          className="flex flex-col gap-2"
        >
          {question.choices.map((choice) => (
            <Radio key={choice} value={choice} label={choice} disabled={disabled} />
          ))}
        </RadioGroup>
      </Field>
    );
  }

  if (question.type === 'MULTI_CHOICE') {
    return (
      <Field label={question.prompt} hint={hint} error={error} required={question.required} grouped>
        <div className="flex flex-col gap-2">
          {question.choices.map((choice) => (
            <Checkbox
              key={choice}
              label={choice}
              disabled={disabled}
              checked={value.includes(choice)}
              onChange={(event) =>
                /*
                 * The choice order is the creator's, not the order they were ticked in: a
                 * response read back beside the question should list its answers the way the
                 * question lists them.
                 */
                onChange(
                  event.target.checked
                    ? question.choices.filter(
                        (option) => option === choice || value.includes(option),
                      )
                    : value.filter((option) => option !== choice),
                )
              }
            />
          ))}
        </div>
      </Field>
    );
  }

  if (question.type === 'DATE') {
    return (
      <Field label={question.prompt} hint={hint} error={error} required={question.required}>
        <TextInput
          type="date"
          disabled={disabled}
          value={single}
          onChange={(event) => onChange(event.target.value === '' ? [] : [event.target.value])}
        />
      </Field>
    );
  }

  return (
    <Field label={question.prompt} hint={hint} error={error} required={question.required}>
      <Textarea
        rows={3}
        autoGrow
        disabled={disabled}
        value={single}
        onChange={(event) => onChange(event.target.value === '' ? [] : [event.target.value])}
      />
    </Field>
  );
}
