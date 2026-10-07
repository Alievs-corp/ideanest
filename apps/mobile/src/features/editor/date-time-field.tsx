import { useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { fromDateTimeLocal, toDateTimeLocal } from '@ideanest/campaign-editor/basics';
import { Icon, Pill, TONES, useFieldControl, useFocusRing, useSurface } from '../../components/ui';
import { INPUT_HEIGHT, inputFrame, inputText } from '../../components/ui/text-input';
import { Glyphs } from '../../icons';
import { formatDate, formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { spacing } from '../../theme';

/**
 * A date and time, or a date, chosen with the platform's picker — the web's `datetime-local` and
 * `date` inputs (#162). The scheduled launch now; a reward's delivery date and its opening and
 * closing times after it.
 *
 * <h2>Contract</h2>
 *
 * Put it inside a `Field`, which names it. `value` and `onChange` speak the API's strings:
 * <ul>
 *   <li>`mode="datetime"` (the default): an ISO instant in UTC, at minute precision — exactly what
 *       the web's `fromDateTimeLocal` sends for the same wall-clock minute, because it is made by
 *       that function (`toDateTimeLocal` of the picked moment, then `fromDateTimeLocal`);</li>
 *   <li>`mode="date"`: the phone's calendar day as `YYYY-MM-DD`, with no zone conversion.</li>
 * </ul>
 * `null` is "not set". `label` names the clear and confirm controls ("Clear Scheduled launch").
 * `clearable` (default true) shows a Clear pill while a value is set. `minimumDate` limits the
 * picker; validation (a past date) stays the caller's.
 *
 * <p>Android opens the system dialogs — the date, then the time. iOS opens an inline picker under
 * the field and commits with "Use this time": choosing a day does not close it.
 */
export interface DateTimeFieldProps {
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly label: string;
  readonly mode?: 'datetime' | 'date';
  readonly minimumDate?: Date;
  readonly clearable?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** A picked moment as the API instant the web would send for the same wall-clock minute. */
export function instantOf(picked: Date): string | null {
  return fromDateTimeLocal(toDateTimeLocal(picked.toISOString()));
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A picked day as `YYYY-MM-DD`, in the phone's calendar. */
export function dayOf(picked: Date): string {
  return `${picked.getFullYear()}-${twoDigits(picked.getMonth() + 1)}-${twoDigits(picked.getDate())}`;
}

/** The field's value as the `Date` the picker opens on, or null. */
function dateOfValue(value: string | null, mode: 'datetime' | 'date'): Date | null {
  if (value === null || value === '') return null;
  const parsed = mode === 'date' ? new Date(`${value}T00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function DateTimeField({
  value,
  onChange,
  label,
  mode = 'datetime',
  minimumDate,
  clearable = true,
  disabled = false,
  testID,
}: DateTimeFieldProps) {
  const t = useT('mobile.editor.dateTime');
  const locale = useLocale();
  const surface = useSurface();
  const tones = TONES[surface];
  const field = useFieldControl({});
  const { ring, onFocus, onBlur } = useFocusRing();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Date>(() => new Date());

  const current = dateOfValue(value, mode);
  const display =
    current === null
      ? t('choose')
      : mode === 'date'
        ? formatDate(current.toISOString(), locale)
        : formatDateTime(current.toISOString(), locale);
  const commit = (picked: Date) => onChange(mode === 'date' ? dayOf(picked) : instantOf(picked));

  function openPicker() {
    Keyboard.dismiss();
    const start = current ?? minimumDate ?? new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: start,
        mode: 'date',
        ...(minimumDate === undefined ? {} : { minimumDate }),
        onValueChange: (_event, day) => {
          if (mode === 'date') {
            commit(day);
            return;
          }
          DateTimePickerAndroid.open({
            value: day,
            mode: 'time',
            onValueChange: (_timeEvent, moment) => commit(moment),
          });
        },
      });
      return;
    }
    if (!open) setShown(start);
    setOpen((previous) => !previous);
  }

  return (
    <View style={styles.field}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={field.accessibilityLabel ?? label}
          accessibilityHint={field.accessibilityHint}
          accessibilityValue={{ text: display }}
          accessibilityState={{ disabled, ...(Platform.OS === 'android' ? {} : { expanded: open }) }}
          disabled={disabled}
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
            style={[inputText('md', surface), styles.value, { color: current === null ? tones.tertiary : tones.primary }]}
          >
            {display}
          </Text>
          <View style={styles.icon}>
            <Icon icon={Glyphs.Calendar} size={18} color={tones.tertiary} />
          </View>
        </Pressable>
        {clearable && current !== null && !disabled ? (
          <Pill
            size="sm"
            variant="ghost"
            label={t('clear')}
            accessibilityLabel={t('clearLabel', { label })}
            onPress={() => {
              setOpen(false);
              onChange(null);
            }}
            testID={testID === undefined ? undefined : `${testID}-clear`}
          />
        ) : null}
      </View>
      {open && Platform.OS !== 'android' && !disabled ? (
        <View style={styles.picker}>
          <DateTimePicker
            value={shown}
            mode={mode}
            display="inline"
            locale={locale}
            {...(minimumDate === undefined ? {} : { minimumDate })}
            themeVariant={surface === 'white' ? 'light' : 'dark'}
            accentColor={tones.primary}
            onValueChange={(_event, picked) => setShown(picked)}
            testID={testID === undefined ? undefined : `${testID}-picker`}
          />
          <View style={styles.start}>
            <Pill
              size="sm"
              label={t('confirm')}
              accessibilityLabel={t('confirmLabel', {
                date: mode === 'date' ? formatDate(shown.toISOString(), locale) : formatDateTime(shown.toISOString(), locale),
                label,
              })}
              onPress={() => {
                commit(shown);
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
  field: { gap: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  trigger: { flex: 1, minHeight: INPUT_HEIGHT.md, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1 },
  icon: { paddingRight: spacing[3] },
  picker: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
});
