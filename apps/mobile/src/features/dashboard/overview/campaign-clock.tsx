import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  describeRemaining,
  isUrgent,
  remainingMs,
  splitRemaining,
  tickIntervalMs,
} from '@ideanest/dashboard/clock';
import { Body, Icon, Tag } from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { catalogue } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, font, fontSize, spacing } from '../../../theme';

/**
 * "12 days left", "5h 3m left", "4m 10s left", "Closed" — the web's `CampaignClock` (#163), on
 * `@ideanest/dashboard/clock`, so both count down against the service's clock to the same second.
 *
 * <p>It ticks at the resolution it shows — a minute while an hour or more is left, a second in the
 * last hour, an hour once closed — and not at all while `active` is false (the app in the
 * background). Coming back, it recomputes at once from the skew measured when the figures arrived.
 *
 * <p>In the last 48 hours a lime "CLOSING SOON" capsule with near-black words sits beside it: the
 * urgency is said in words, never by colour alone. The value is a `timer` read when focused and
 * never announced on its own, and it does not move: the number changes in place.
 */
export interface CampaignClockProps {
  readonly deadline: string | null | undefined;
  readonly skewMs: number;
  /** False while the app is in the background: no timer runs. */
  readonly active: boolean;
  /** Injected by tests. */
  readonly now?: () => number;
}

export function CampaignClock({ deadline, skewMs, active, now = Date.now }: CampaignClockProps) {
  const locale = useLocale();
  const copy = catalogue(locale).dashboard.clock;
  const [remaining, setRemaining] = useState<number | null>(() => remainingMs(deadline, now(), skewMs));

  useEffect(() => {
    if (!active) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const left = remainingMs(deadline, now(), skewMs);
      setRemaining(left);
      if (left !== null) timer = setTimeout(tick, tickIntervalMs(left));
    };
    tick();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
    // `now` is Date.now in the app and fixed per test; a new function each render must not restart it.
  }, [active, deadline, skewMs]);

  if (remaining === null) {
    return <Body testID="campaign-clock-none">{copy.none}</Body>;
  }

  const label = describeRemaining(splitRemaining(remaining), copy, locale);
  const urgent = isUrgent(remaining);
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={urgent ? `${label}, ${copy.urgent}` : label}
      accessibilityLiveRegion="none"
      style={styles.row}
      testID="campaign-clock"
    >
      <View style={styles.time}>
        <Icon icon={Glyphs.Clock} size={18} color={colors.textPrimary} />
        <Text style={styles.text}>{label}</Text>
      </View>
      {urgent ? (
        <Tag variant="urgent" label={copy.urgent.toLocaleUpperCase(locale)} testID="campaign-clock-urgent" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  time: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  text: {
    ...font.medium,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
