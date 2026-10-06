import { useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  Icon,
  Pill,
  TONES,
  useFieldControl,
  useFocusRing,
  usePressScale,
  useSurface,
} from '../../components/ui';
// The input skin, so the date reads as a field beside the text answers (as `Select` does).
import { INPUT_HEIGHT, inputFrame, inputText } from '../../components/ui/text-input';
import { Glyphs } from '../../icons';
import { formatDate, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { spacing } from '../../theme';
import { dateAnswerOf, dateOfAnswer } from './survey-form';

export interface DateAnswerProps {
  /** `YYYY-MM-DD`, or `undefined` while unanswered. */
  readonly value: string | undefined;
  readonly onChange: (value: string | undefined) => void;
  /** The question's prompt, for the clear button's name. */
  readonly question: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly testID?: string;
}

/**
 * A DATE question — `@react-native-community/datetimepicker` behind a pressable that shows the
 * answer, inside the question's `Field` (which names it). Android opens the system dialog; iOS
 * opens an inline calendar under the field and closes it on a choice. The calendar opens on the
 * answer or, unanswered, on today — and tapping the day already selected fires nothing, so a
 * "Use this date" pill under it commits the day shown (today is a real answer). The answer is
 * the phone's calendar day as `YYYY-MM-DD` (`dateAnswerOf`), with no time zone conversion. An
 * optional question can be cleared; a required one can only be changed.
 */
export function DateAnswer({ value, onChange, question, required, disabled, testID }: DateAnswerProps) {
  const t = useT();
  const locale = useLocale();
  const surface = useSurface();
  const tones = TONES[surface];
  const field = useFieldControl({});
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const [open, setOpen] = useState(false);
  // The day the iOS calendar shows: the answer, or today when unanswered. Fixed while it is open.
  const [shownDay, setShownDay] = useState<Date>(() => new Date());

  const date = dateOfAnswer(value);
  const shown = date === null ? t('mobile.surveys.chooseDate') : formatDate(date.toISOString(), locale);
  const choose = (picked: Date) => onChange(dateAnswerOf(picked));

  function openPicker() {
    // A keyboard left up by a text answer would cover the calendar.
    Keyboard.dismiss();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: date ?? new Date(),
        mode: 'date',
        onValueChange: (_event, picked) => choose(picked),
      });
      return;
    }
    if (!open) setShownDay(date ?? new Date());
    setOpen((previous) => !previous);
  }

  return (
    <View style={styles.answer}>
      <View style={styles.row}>
        <Animated.View style={[styles.grow, press.style]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={field.accessibilityLabel}
            accessibilityHint={field.accessibilityHint}
            accessibilityValue={{ text: shown }}
            accessibilityState={{ disabled, ...(Platform.OS === 'android' ? {} : { expanded: open }) }}
            disabled={disabled}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            onPress={openPicker}
            onFocus={onFocus}
            onBlur={onBlur}
            testID={testID}
            style={[
              ...inputFrame({ focused: ring !== undefined, invalid: field.invalid, disabled, surface }),
              styles.trigger,
              ring,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[inputText('md', surface), styles.value, { color: date === null ? tones.tertiary : tones.primary }]}
            >
              {shown}
            </Text>
            <View style={styles.icon}>
              <Icon icon={Glyphs.Calendar} size={18} color={tones.tertiary} />
            </View>
          </Pressable>
        </Animated.View>
        {!required && date !== null && !disabled ? (
          <Pill
            size="sm"
            variant="ghost"
            label={t('mobile.surveys.clearDate')}
            accessibilityLabel={t('mobile.surveys.clearDateLabel', { question })}
            onPress={() => {
              setOpen(false);
              onChange(undefined);
            }}
            testID={testID === undefined ? undefined : `${testID}-clear`}
          />
        ) : null}
      </View>
      {open && Platform.OS !== 'android' && !disabled ? (
        <View style={styles.calendar}>
          <DateTimePicker
            value={shownDay}
            mode="date"
            display="inline"
            locale={locale}
            themeVariant={surface === 'white' ? 'light' : 'dark'}
            accentColor={tones.primary}
            onValueChange={(_event, picked) => {
              choose(picked);
              setOpen(false);
            }}
            testID={testID === undefined ? undefined : `${testID}-picker`}
          />
          <View style={styles.start}>
            <Pill
              size="sm"
              label={t('mobile.surveys.confirmDate')}
              accessibilityLabel={t('mobile.surveys.confirmDateLabel', {
                date: formatDate(shownDay.toISOString(), locale),
                question,
              })}
              onPress={() => {
                choose(shownDay);
                setOpen(false);
              }}
              testID={testID === undefined ? undefined : `${testID}-confirm`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { gap: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  grow: { flex: 1 },
  trigger: { minHeight: INPUT_HEIGHT.md, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1 },
  icon: { paddingRight: spacing[3] },
  calendar: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
});
