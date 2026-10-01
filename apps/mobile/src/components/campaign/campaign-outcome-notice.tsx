import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleCheck, CircleSlash } from 'lucide-react-native';
import { formatMoney } from '@ideanest/money';
import type { CampaignPage } from '../../lib/campaign-page';
import { formatDay, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';
import { Icon } from '../ui';

/**
 * The Campaign tab's first block — the web's `CampaignOutcomeNotice` (#155): how a closed campaign
 * ended, from the figures the service froze when it closed.
 *
 * <p>Funded is every state but UNSUCCESSFUL and CANCELED — read from the state, never recomputed
 * from the figures, so the page cannot disagree with the service about somebody's refund. Funded
 * takes `success` on its icon (with the words beside it); not funded is a grey `CircleSlash`.
 *
 * <p>"It raised **X** of a Y goal from N backers on {date}" is the catalogue's sentence, with the
 * backers declined by ICU and the day the campaign closed as a UTC day, as the web prints it.
 * Without the figures it says only whether 80% was reached.
 */
export function CampaignOutcomeNotice({ campaign }: { readonly campaign: CampaignPage }) {
  const t = useT('campaign.outcome');
  const locale = useLocale();
  const { outcome } = campaign;
  if (outcome === null) return null;

  const funded = campaign.state !== 'UNSUCCESSFUL' && campaign.state !== 'CANCELED';
  const closedOn = formatDay(outcome.finalisedAt, locale, 'UTC');
  const strong = (chunks: ReactNode) => <Text style={styles.strong}>{chunks}</Text>;

  return (
    <View style={styles.card} testID="outcome-notice">
      <View style={styles.heading}>
        <Icon
          icon={funded ? CircleCheck : CircleSlash}
          size={20}
          color={funded ? colors.success : colors.textSecondary}
        />
        <Text accessibilityRole="header" style={styles.title}>
          {funded ? t('funded') : t('notFunded')}
        </Text>
      </View>
      <Text style={styles.body}>
        {outcome.pledged === null || outcome.goal === null
          ? funded
            ? t('reached')
            : t('notReached')
          : t.rich(closedOn === null ? 'summaryUndated' : 'summary', {
              b: strong,
              pledged: formatMoney(outcome.pledged),
              goal: formatMoney(outcome.goal),
              backers: outcome.backersCount,
              date: closedOn ?? '',
            })}
      </Text>
      <Text style={styles.after}>{funded ? t('settling') : t('refunded')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[3],
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
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textReading,
  },
  after: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  strong: { ...font.medium, color: colors.textPrimary },
});
