import { StyleSheet, Text, View } from 'react-native';
import { CalendarClock, CircleCheck } from 'lucide-react-native';
import type { UpdateObligation } from '@ideanest/campaign/obligation';
import { formatDay, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, readingMeasure, spacing } from '../../theme';
import { Icon } from '../ui';

/**
 * Block 10 — the web's `UpdateObligationNotice` (#155): §5.5's monthly update, stated as a fact.
 *
 * <p>Drawn only for `NEVER_UPDATED`, `LAPSED` and `COMPLETE`. A creator who is up to date gets
 * nothing, and one whose month is nearly up (`DUE_SOON`) gets nothing either — that is between the
 * platform and the creator, and publishing it would turn a reminder into a countdown to somebody's
 * failure. A notice that only ever appeared when something was wrong would be a badge by its
 * presence, which is why "fulfilment is finished" is said too.
 *
 * <p>The dates are **UTC days**, as the web prints them: "last posted on 14 March" is a day, and a
 * zone boundary would change it at most by one. Neutral colours throughout — not lime (the person
 * who has to act is the creator, who is not reading this) and not success (nobody here has
 * checked that rewards arrived).
 */
export function UpdateObligationNotice({ obligation }: { readonly obligation: UpdateObligation }) {
  const t = useT('campaign.obligation');
  const locale = useLocale();

  if (obligation.state === 'CURRENT' || obligation.state === 'DUE_SOON') return null;

  const due = formatDay(obligation.dueAt, locale, 'UTC');
  // An unreadable due date draws nothing rather than "late by Invalid Date".
  if (due === null) return null;
  const lastUpdate = formatDay(obligation.lastUpdateAt, locale, 'UTC');
  const complete = obligation.state === 'COMPLETE';

  return (
    <View style={styles.card} testID="obligation-notice">
      <View style={styles.heading}>
        <Icon icon={complete ? CircleCheck : CalendarClock} size={20} color={colors.textSecondary} />
        <Text accessibilityRole="header" style={styles.title}>
          {complete ? t('completeHeading') : t('lateHeading')}
        </Text>
      </View>
      <Text style={styles.body}>
        {complete
          ? t('completeBody')
          : obligation.state === 'NEVER_UPDATED' || lastUpdate === null
            ? t('neverUpdatedBody', { due })
            : t('lateBody', { lastUpdate, due })}
      </Text>
      <Text style={styles.rule}>{t('rule')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[2],
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: {
    ...font.medium,
    flexShrink: 1,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    color: colors.textPrimary,
  },
  body: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textReading,
  },
  rule: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
});
