import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Clock } from 'lucide-react-native';
import {
  countdownIntervalMs,
  countdownLabel,
  remainingUntil,
  type CountdownUnits,
} from '@ideanest/campaign/deadline';
import { catalogue, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { Icon } from '../ui';

/**
 * Block 6 — the web's `CampaignCountdown` (#155): "3 days, 4 hours left", ticking.
 *
 * <h2>The shared clock, and when it ticks</h2>
 *
 * The label and the interval are `@ideanest/campaign/deadline`'s `countdownLabel` and
 * `countdownIntervalMs` — every minute while an hour or more remains, every second after — so it
 * says what the web says at the same instant. It stops at the deadline: past it there is nothing
 * to count, and the component draws nothing.
 *
 * <h2>Paused in the background</h2>
 *
 * `active` false (blurred, or the app backgrounded) clears the timer; true recomputes from the
 * clock at once and starts again. A timer left running behind another app is a wake-up a second
 * for a number nobody is looking at.
 *
 * <h2>A timer, not a live region</h2>
 *
 * Role `timer` with the catalogue's "Time left to back this campaign: …" as its name. It is
 * deliberately **not** an `accessibilityLiveRegion`: one that announced every second would talk
 * over everything else on the page. A reader who wants the time moves to it. No animation either
 * — docs/motion-system.md §6: the number changes, it does not move.
 */
export interface CampaignCountdownProps {
  readonly deadline: string;
  readonly active: boolean;
}

export function CampaignCountdown({ deadline, active }: CampaignCountdownProps) {
  const t = useT('campaign.countdown');
  const locale = useLocale();
  // The catalogue's unit tables, read as data: `countdownLabel` declines them itself.
  const units = useMemo<CountdownUnits>(() => {
    const { units: table, pair } = catalogue(locale).campaign.countdown;
    return { ...table, pair };
  }, [locale]);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const at = new Date();
      setNow(at);
      const remaining = remainingUntil(deadline, at);
      if (remaining === null || remaining.past) return;
      timer = setTimeout(tick, countdownIntervalMs(remaining));
    };

    // Recomputed on every return, so a phone that slept for an hour shows the hour gone.
    tick();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, deadline]);

  const remaining = remainingUntil(deadline, now);
  const label = remaining === null ? null : countdownLabel(remaining, units, locale);
  if (label === null) return null;

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={t('label', { time: label })}
      accessibilityLiveRegion="none"
      style={styles.row}
      testID="campaign-countdown"
    >
      <Icon icon={Clock} size={14} color={colors.textSecondary} />
      <Text style={styles.text}>{t('left', { time: label })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  text: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});
