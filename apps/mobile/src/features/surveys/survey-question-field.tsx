import { StyleSheet, View } from 'react-native';
import type { SurveyQuestion } from '@ideanest/account/surveys';
import { Body, Checkbox, Field, Meta, Radio, RadioGroup, Subheading, Textarea } from '../../components/ui';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, radius, spacing } from '../../theme';
import { TextLink } from '../fulfilment/text-link';
import { DateAnswer } from './date-answer';
import { toggleChoice } from './survey-form';

export interface SurveyQuestionFieldProps {
  readonly question: SurveyQuestion;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly disabled: boolean;
  readonly error?: string;
  /** Where an ADDRESS question sends somebody: the pledge's address screen. */
  readonly onAddress: () => void;
}

/**
 * One question, drawn as whatever its type is — the web's `SurveyQuestionField`.
 *
 * The prompt, help text and choices are the creator's words and are not translated. ADDRESS is
 * not a field: the answer is the pledge's encrypted shipping address, so it renders as a note and
 * a link to that screen, and contributes nothing to the request. An unknown type renders as text
 * rather than disappearing — a newer service could add a sixth.
 */
export function SurveyQuestionField({ question, value, onChange, disabled, error, onAddress }: SurveyQuestionFieldProps) {
  const t = useT('account.surveys.question');
  const hint = question.helpText ?? undefined;
  const single = value[0];
  const testID = `survey-question-${question.id}`;

  if (question.type === 'ADDRESS') {
    return (
      <View style={styles.address} testID={testID}>
        <Subheading>{question.prompt}</Subheading>
        {hint === undefined ? null : <Body>{hint}</Body>}
        <Meta>{t('addressNote')}</Meta>
        <TextLink label={t('addressLink')} icon={Glyphs.Location} onPress={onAddress} testID={`${testID}-address`} />
      </View>
    );
  }

  if (question.type === 'CHOICE') {
    return (
      <Field label={question.prompt} hint={hint} error={error} required={question.required} grouped testID={testID}>
        <RadioGroup value={single ?? null} onChange={(next) => onChange([next])} disabled={disabled}>
          {question.choices.map((choice) => (
            <Radio key={choice} value={choice} label={choice} testID={`${testID}-${choice}`} />
          ))}
        </RadioGroup>
      </Field>
    );
  }

  if (question.type === 'MULTI_CHOICE') {
    return (
      <Field label={question.prompt} hint={hint} error={error} required={question.required} grouped testID={testID}>
        <View style={styles.choices}>
          {question.choices.map((choice) => (
            <Checkbox
              key={choice}
              label={choice}
              disabled={disabled}
              checked={value.includes(choice)}
              onChange={(checked) => onChange(toggleChoice(question.choices, value, choice, checked))}
              testID={`${testID}-${choice}`}
            />
          ))}
        </View>
      </Field>
    );
  }

  if (question.type === 'DATE') {
    return (
      <Field label={question.prompt} hint={hint} error={error} required={question.required} testID={testID}>
        <DateAnswer
          value={single}
          onChange={(next) => onChange(next === undefined ? [] : [next])}
          question={question.prompt}
          required={question.required}
          disabled={disabled}
          testID={`${testID}-date`}
        />
      </Field>
    );
  }

  return (
    <Field label={question.prompt} hint={hint} error={error} required={question.required} testID={testID}>
      <Textarea
        value={single ?? ''}
        onChangeText={(next) => onChange(next === '' ? [] : [next])}
        disabled={disabled}
        testID={`${testID}-text`}
      />
    </Field>
  );
}

const styles = StyleSheet.create({
  // Inside the card's muted block, the note is the sheet's own white: the web's surface-1 inset.
  address: { gap: spacing[2], padding: spacing[4], borderRadius: radius.lg, backgroundColor: colors.whiteSurface },
  choices: { gap: spacing[2] },
});
