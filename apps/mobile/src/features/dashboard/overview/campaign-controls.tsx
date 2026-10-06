import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ApiError } from '@ideanest/api-client';
import {
  controlsOffer,
  extensionUntil,
  extensionWindow,
  isExtensionDay,
  refusalOf,
  type ExtensionWindow,
} from '@ideanest/dashboard/controls';
import {
  Body,
  Card,
  CardTitle,
  Field,
  Icon,
  InlineAlert,
  Pill,
  TONES,
  useFieldControl,
  useFocusRing,
  usePressScale,
  useSurface,
} from '../../../components/ui';
import { FOCUS_DELAY_MS, focusOn } from '../../../components/ui/overlay';
import { INPUT_HEIGHT, inputFrame, inputText } from '../../../components/ui/text-input';
import { Glyphs } from '../../../icons';
import { formatDay, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { spacing } from '../../../theme';
import {
  extendCampaign,
  isAmbiguous,
  lateAnswer,
  UnansweredWrite,
  withdrawCampaign,
  type CampaignDashboard,
  type OverviewRead,
} from './api';

/**
 * "Extend or withdraw" — the web's `CampaignControls` (#163), on `@ideanest/dashboard/controls`.
 *
 * <h2>Two presses, asked inline</h2>
 *
 * Each action opens a confirmation card in place (not a modal), which says what happens and moves
 * screen-reader focus to its lime confirm button; Cancel is a ghost pill beside it. Lime is spent
 * on that button and nothing else in the card.
 *
 * <h2>A write with no answer is not a failure</h2>
 *
 * Neither endpoint takes an `Idempotency-Key`: each is a one-way state transition, and a repeat is
 * refused. So a request that times out or loses its connection may have happened. The card does
 * not say "failed" then: it reads the dashboard again and says what the campaign now is. The
 * buttons are blocked from the first press until that read has come back, so a double tap cannot
 * send two requests. Success is shown only once the service has said so; errors appear at once.
 *
 * <h2>A timeout is not an answer either</h2>
 *
 * Past `WRITE_TIMEOUT_MS` the request is still out, and the service can commit it seconds
 * later. So the card says it is checking and keeps everything locked until the request itself
 * comes back, then words what it said. Only a request that never comes back within
 * `LATE_ANSWER_MS` more is settled by a re-read alone, and an unchanged campaign is then
 * worded as not confirmed rather than as not done — as is a gateway that gave up waiting.
 */

type Mode = 'idle' | 'confirm-extend' | 'confirm-withdraw';
type Action = 'extend' | 'withdraw';

interface Message {
  readonly variant: 'success' | 'warning' | 'danger';
  readonly text: string;
}

export interface CampaignControlsProps {
  readonly projectId: string;
  readonly dashboard: CampaignDashboard;
  /** False offline: nothing can be sent, and the card says why. */
  readonly online: boolean;
  /** True when the figures above are a copy whose refresh failed: nothing is sent on them. */
  readonly stale?: boolean;
  /** Reads the dashboard again; the fresh read, or null when it could not be made. */
  readonly reread: () => Promise<OverviewRead | null>;
  /** The campaign's state as words ("Live"). */
  readonly stateLabel: (state: string) => string;
  readonly extend?: typeof extendCampaign;
  readonly withdraw?: typeof withdrawCampaign;
}

export function CampaignControls({
  projectId,
  dashboard,
  online,
  stale = false,
  reread,
  stateLabel,
  extend = extendCampaign,
  withdraw = withdrawCampaign,
}: CampaignControlsProps) {
  const t = useT('dashboardControls');
  const tAll = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [day, setDay] = useState('');
  // Set synchronously on the first press: a second tap in the same frame sees it before React re-renders.
  const inFlight = useRef(false);
  const confirm = useRef<View>(null);

  const state = dashboard.state ?? '';
  const window = extensionWindow(dashboard.deadline);
  const offer = controlsOffer(state, dashboard.percentFunded, dashboard.deadline);
  const latest = window === null ? '' : dayLabel(window.latestDay, locale);
  const chosen = day === '' ? '' : dayLabel(day, locale);

  useEffect(() => {
    if (mode === 'idle') return undefined;
    const timer = setTimeout(() => focusOn(confirm.current), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mode]);

  // After a withdrawal the state leaves the four, and the card stays only to say what happened.
  if (!offer.shown && message === null) return null;

  function start(next: Mode) {
    setMessage(null);
    if (next === 'confirm-extend' && !isExtensionDay(day, window)) {
      setMessage({ variant: 'danger', text: t('extendDate', { latest }) });
      return;
    }
    setMode(next);
  }

  async function run(action: Action) {
    if (inFlight.current || !online || stale) return;
    // The picker enforces the bounds; they are checked again here, before anything is sent.
    if (action === 'extend' && (window === null || !isExtensionDay(day, window))) {
      setMode('idle');
      setMessage({ variant: 'danger', text: t('extendDate', { latest }) });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (action === 'extend' && window !== null) {
        await extend(projectId, extensionUntil(day, window));
      } else {
        await withdraw(projectId);
      }
      await succeeded(action);
    } catch (cause) {
      if (cause instanceof UnansweredWrite) {
        // Still out: nothing is said and nothing can be pressed until the request itself is back.
        setChecking(true);
        const answer = await lateAnswer(cause);
        if (answer === null) await settle(action, false);
        else if (answer.ok) await succeeded(action);
        else await failed(action, answer.cause);
      } else {
        await failed(action, cause);
      }
    } finally {
      inFlight.current = false;
      setChecking(false);
      setBusy(false);
    }
  }

  async function succeeded(action: Action) {
    setMessage({ variant: 'success', text: action === 'extend' ? t('extended', { date: chosen }) : t('withdrawn') });
    setMode('idle');
    await reread();
  }

  async function failed(action: Action, cause: unknown) {
    if (isAmbiguous(cause)) {
      setChecking(true);
      // A dropped connection came back with nothing; a gateway that gave up may still be waiting.
      await settle(action, !(cause instanceof ApiError));
      return;
    }
    const key = refusalOf(cause instanceof ApiError ? cause.problem : null);
    setMessage({
      variant: 'danger',
      text: key === 'extendDate' ? t('extendDate', { latest }) : t(key),
    });
    // A refusal for the campaign's state means the figures above are behind it.
    if (cause instanceof ApiError && cause.status === 409) {
      setMode('idle');
      void reread();
    }
  }

  /** Reads the campaign again and says what it is now. `settled`: the request can no longer land. */
  async function settle(action: Action, settled: boolean) {
    const after = await reread();
    setMode('idle');
    setMessage(settledMessage(action, after, settled));
  }

  function settledMessage(action: Action, after: OverviewRead | null, settled: boolean): Message {
    if (after === null) {
      return { variant: 'warning', text: tAll('mobile.dashboard.outcomeUnknown') };
    }
    const now = after.dashboard.state ?? '';
    if (action === 'withdraw') {
      if (now === 'WITHDRAWN') return { variant: 'success', text: t('withdrawn') };
      return {
        variant: 'warning',
        text: tAll(settled ? 'mobile.dashboard.withdrawNotTaken' : 'mobile.dashboard.withdrawUnconfirmed', {
          state: stateLabel(now),
        }),
      };
    }
    if (now === 'EXTENDED') return { variant: 'success', text: t('extended', { date: chosen }) };
    return {
      variant: 'warning',
      text: tAll(settled ? 'mobile.dashboard.extendNotTaken' : 'mobile.dashboard.extendUnconfirmed'),
    };
  }

  const blocked = busy || !online || stale;

  return (
    <Card size="md" testID="campaign-controls">
      <View style={styles.card}>
        <CardTitle accessibilityRole="header">{t('heading')}</CardTitle>
        <Body>{t('rule')}</Body>

        {!online ? (
          <InlineAlert
            variant="warning"
            politeness="polite"
            description={tAll('mobile.dashboard.controlsOffline')}
            testID="campaign-controls-offline"
          />
        ) : null}

        {message === null ? null : (
          <InlineAlert
            variant={message.variant}
            politeness={message.variant === 'success' ? 'polite' : 'assertive'}
            description={message.text}
            testID={`campaign-controls-${message.variant}`}
          />
        )}

        {mode === 'confirm-extend' ? (
          <Confirmation
            confirmRef={confirm}
            title={t('extendConfirmTitle', { date: chosen })}
            body={t('extendConfirmBody')}
            action={checking ? tAll('mobile.dashboard.checking') : busy ? t('extending') : t('extendNow')}
            cancel={t('cancel')}
            busy={busy}
            disabled={!online || stale}
            onConfirm={() => void run('extend')}
            onCancel={() => setMode('idle')}
            testID="campaign-extend-confirm"
          />
        ) : null}

        {mode === 'confirm-withdraw' ? (
          <Confirmation
            confirmRef={confirm}
            title={t('withdrawConfirmTitle')}
            body={t('withdrawConfirmBody')}
            action={checking ? tAll('mobile.dashboard.checking') : busy ? t('withdrawing') : t('withdrawNow')}
            cancel={t('cancel')}
            busy={busy}
            disabled={!online || stale}
            onConfirm={() => void run('withdraw')}
            onCancel={() => setMode('idle')}
            testID="campaign-withdraw-confirm"
          />
        ) : null}

        {mode === 'idle' && offer.shown ? (
          <View style={styles.actions}>
            {offer.canExtend && window !== null ? (
              <View style={styles.extend}>
                <Field label={t('extendLabel')} hint={t('extendHint', { latest })}>
                  <DeadlinePicker
                    day={day}
                    window={window}
                    disabled={blocked}
                    onChange={(next) => {
                      setMessage(null);
                      setDay(next);
                    }}
                  />
                </Field>
                <Pill
                  variant="outline"
                  label={t('extend')}
                  iconLeft={Glyphs.CalendarAdd}
                  disabled={blocked}
                  onPress={() => start('confirm-extend')}
                  testID="campaign-extend"
                />
              </View>
            ) : null}

            {offer.canWithdraw ? (
              <Pill
                variant="outline"
                label={t('withdraw')}
                iconLeft={Glyphs.Bank}
                disabled={blocked}
                onPress={() => start('confirm-withdraw')}
                testID="campaign-withdraw"
              />
            ) : null}

            {offer.belowThreshold ? <Body testID="campaign-below-threshold">{t('belowThreshold')}</Body> : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function Confirmation({
  confirmRef,
  title,
  body,
  action,
  cancel,
  busy,
  disabled,
  onConfirm,
  onCancel,
  testID,
}: {
  readonly confirmRef: RefObject<View | null>;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly cancel: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testID: string;
}) {
  return (
    <Card size="sm" testID={testID}>
      <View style={styles.confirm}>
        <CardTitle accessibilityRole="header">{title}</CardTitle>
        <Body>{body}</Body>
        <View style={styles.buttons}>
          <Pill
            ref={confirmRef}
            variant="accent"
            label={action}
            busy={busy}
            disabled={disabled}
            onPress={onConfirm}
            testID={`${testID}-yes`}
          />
          <Pill variant="ghost" label={cancel} disabled={busy} onPress={onCancel} testID={`${testID}-cancel`} />
        </View>
      </View>
    </Card>
  );
}

/** `YYYY-MM-DD` for the calendar day a picked date shows, in the phone's own calendar. */
function dayOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The picker's date for a `YYYY-MM-DD` day: local noon, so no zone moves it to a neighbour. */
function dateOfDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12);
}

/** A window day as words, the web's `formatDay` in UTC. */
function dayLabel(day: string, locale: ReturnType<typeof useLocale>): string {
  return formatDay(`${day}T00:00:00Z`, locale, 'UTC') ?? day;
}

/**
 * The "New deadline" field: `@react-native-community/datetimepicker` behind a pressable that shows
 * the chosen day, limited to the window by the picker's own minimum and maximum. Android opens the
 * system dialog; iOS opens an inline calendar, committed with "Use this date".
 */
function DeadlinePicker({
  day,
  window,
  disabled,
  onChange,
}: {
  readonly day: string;
  readonly window: ExtensionWindow;
  readonly disabled: boolean;
  readonly onChange: (day: string) => void;
}) {
  const t = useT('mobile.dashboard');
  const locale = useLocale();
  const surface = useSurface();
  const tones = TONES[surface];
  const field = useFieldControl({});
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const [open, setOpen] = useState(false);
  const minimum = dateOfDay(window.firstDay);
  const maximum = dateOfDay(window.latestDay);
  const [shown, setShown] = useState<Date>(minimum);

  const value = day === '' ? t('chooseDate') : dayLabel(day, locale);
  const pick = (picked: Date) => {
    const next = dayOf(picked);
    // A picker that let a day outside the window through is ignored rather than trusted.
    if (isExtensionDay(next, window)) onChange(next);
  };

  function openPicker() {
    Keyboard.dismiss();
    const start = day === '' ? minimum : dateOfDay(day);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: start,
        mode: 'date',
        minimumDate: minimum,
        maximumDate: maximum,
        onValueChange: (_event, picked) => pick(picked),
      });
      return;
    }
    if (!open) setShown(start);
    setOpen((previous) => !previous);
  }

  return (
    <View style={styles.picker}>
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={field.accessibilityLabel}
          accessibilityHint={field.accessibilityHint}
          accessibilityValue={{ text: value }}
          accessibilityState={{ disabled, ...(Platform.OS === 'android' ? {} : { expanded: open }) }}
          disabled={disabled}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onPress={openPicker}
          onFocus={onFocus}
          onBlur={onBlur}
          testID="campaign-deadline"
          style={[...inputFrame({ focused: ring !== undefined, invalid: false, disabled, surface }), styles.trigger, ring]}
        >
          <Text style={[inputText('md', surface), styles.value, { color: day === '' ? tones.tertiary : tones.primary }]}>
            {value}
          </Text>
          <View style={styles.icon}>
            <Icon icon={Glyphs.Calendar} size={18} color={tones.tertiary} />
          </View>
        </Pressable>
      </Animated.View>
      {open && Platform.OS !== 'android' && !disabled ? (
        <View style={styles.picker}>
          <DateTimePicker
            value={shown}
            mode="date"
            display="inline"
            locale={locale}
            minimumDate={minimum}
            maximumDate={maximum}
            themeVariant={surface === 'white' ? 'light' : 'dark'}
            accentColor={tones.primary}
            onValueChange={(_event, picked) => {
              pick(picked);
              setOpen(false);
            }}
            testID="campaign-deadline-picker"
          />
          <View style={styles.start}>
            <Pill
              size="sm"
              label={t('useDate')}
              accessibilityLabel={t('useDateLabel', { date: dayLabel(dayOf(shown), locale) })}
              onPress={() => {
                pick(shown);
                setOpen(false);
              }}
              testID="campaign-deadline-use"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[3] },
  actions: { gap: spacing[4] },
  extend: { gap: spacing[3] },
  confirm: { gap: spacing[3] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  picker: { gap: spacing[2] },
  trigger: { minHeight: INPUT_HEIGHT.md, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1 },
  icon: { paddingRight: spacing[3] },
  start: { alignSelf: 'flex-start' },
});
