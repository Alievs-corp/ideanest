import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import type { ProjectState } from '@ideanest/campaign/states';
import { successThresholdOf } from '@ideanest/campaign/threshold';
import type { CampaignPage } from '../../lib/campaign-page';
import { formatInstant, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, readingMeasure, spacing } from '../../theme';
import { Icon } from '../ui';

/**
 * Block 9 — the web's `CampaignTrustBlock` (#155): the platform's rule in fixed copy, then what
 * the rule means for this campaign.
 *
 * <p>The fixed paragraph is `campaign.trust.body` on every campaign, closed ones included — a
 * reader of a campaign that failed a year ago is entitled to the rule that decided its refunds.
 *
 * <p>The second sentence names the amount — 80% of the goal, rounded **up** to the cent by the
 * shared `successThresholdOf`, `decimal.js` only — and the deadline **in the device's time zone,
 * with the zone named** (`formatInstant`). Open campaigns are told in the future tense, closed
 * ones in the past; a campaign with no deadline gets the fixed paragraph alone rather than an
 * invented date.
 *
 * <p>A neutral surface-2 card: not lime (it is the opposite of urgency) and not success (that
 * would read as the platform vouching for this campaign).
 */

/** The states whose outcome is still ahead — decided by the state, never by the clock. */
const OPEN_STATES: readonly ProjectState[] = ['PRELAUNCH', 'LIVE', 'CLOSING_WINDOW', 'EXTENDED'];

export function CampaignTrustBlock({ campaign }: { readonly campaign: CampaignPage }) {
  const t = useT('campaign.trust');
  const locale = useLocale();
  const open = OPEN_STATES.includes(campaign.state);
  const deadline = formatInstant(campaign.deadline, locale);

  const strong = (chunks: ReactNode) => <Text style={styles.strong}>{chunks}</Text>;
  const when = () => <Text style={styles.strong}>{deadline}</Text>;

  let sentence: ReactNode = null;
  if (deadline !== null) {
    sentence = !open
      ? t.rich('closed', { deadline: when })
      : campaign.goal === null
        ? t.rich('openNoGoal', { deadline: when })
        : t.rich('open', {
            deadline: when,
            b: strong,
            threshold: formatMoney(successThresholdOf(campaign.goal)),
            goal: formatMoney(campaign.goal),
          });
  }

  return (
    <View style={styles.card} testID="trust-block">
      <View style={styles.heading}>
        <Icon icon={Glyphs.ShieldTick} size={20} color={colors.textSecondary} />
        <Text accessibilityRole="header" style={styles.title}>
          {t('heading')}
        </Text>
      </View>
      <Text style={styles.body}>{t('body')}</Text>
      {sentence === null ? null : (
        <Text style={styles.rule} testID="trust-sentence">
          {sentence}
        </Text>
      )}
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
  strong: { ...font.medium, color: colors.textPrimary },
});
