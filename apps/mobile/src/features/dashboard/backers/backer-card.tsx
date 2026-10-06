import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Backer } from '@ideanest/dashboard/backers';
import type { Locale } from '@ideanest/messages';
import { Body, Card, CardTitle, Icon, Meta, TONES, useSurface } from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { formatDate, useT, type Translate } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { colors, spacing } from '../../../theme';

/** What a pledge that took no reward, or a tier since removed, is called on the card. */
function rewardOf(backer: Backer, t: Translate): string {
  return (
    backer.rewardTitle ??
    (backer.rewardTierId === undefined ? t('dashboard.table.noReward') : t('dashboard.table.removedTier'))
  );
}

/**
 * The card's accessible name: the web table's six columns in its order — Backer, Reward,
 * Pledged, State, Destination, Backed — each with its heading, so a screen reader hears the
 * row the way a sighted creator reads across it.
 */
export function backerCardLabel(backer: Backer, t: Translate, locale: Locale): string {
  const field = (label: string, value: string) => t('mobile.dashboardBackers.cardField', { label, value });
  const who = [backer.name, backer.email, backer.anonymous ? t('dashboard.table.anonymous') : null]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  return [
    field(t('dashboard.table.backer'), who),
    field(t('dashboard.table.reward'), rewardOf(backer, t)),
    field(t('dashboard.table.pledged'), formatMoney(backer.amount)),
    field(t('dashboard.table.state'), t(`dashboard.states.${backer.state}`)),
    field(t('dashboard.table.destination'), backer.country ?? t('dashboard.charts.noDestination')),
    field(t('dashboard.table.backed'), formatDate(backer.backedAt, locale)),
  ].join(', ');
}

/**
 * One backer — the web's `BackerTable` row as a card, which a 720pt table cannot be on a phone.
 * The name and email lead, the amount sits on the right in tabular figures, and the reward,
 * state, destination and date run underneath. Anonymity is shown, not obeyed: the creator still
 * has to address a parcel, so the name stays and the eye icon and words say what it means. A
 * failed payment carries a danger icon beside its word, never colour alone.
 */
export const BackerCard = memo(function BackerCard({ backer }: { readonly backer: Backer }) {
  const t = useT();
  const locale = useLocale();
  const surface = useSurface();
  const failed = backer.state === 'CHARGE_FAILED';

  return (
    <View
      accessible
      accessibilityLabel={backerCardLabel(backer, t, locale)}
      testID={`backer-card-${backer.pledgeId}`}
    >
      <Card size="sm">
        <View style={styles.inner}>
          <View style={styles.top}>
            <View style={styles.who}>
              <CardTitle numberOfLines={2}>{backer.name}</CardTitle>
              <Body numberOfLines={1}>{backer.email}</Body>
              {backer.anonymous ? (
                <View style={styles.inline}>
                  <Icon icon={Glyphs.EyeSlash} size={14} color={TONES[surface].tertiary} />
                  <Meta>{t('dashboard.table.anonymous')}</Meta>
                </View>
              ) : null}
            </View>
            <CardTitle style={styles.amount}>{formatMoney(backer.amount)}</CardTitle>
          </View>
          <View style={styles.meta}>
            <Meta>{rewardOf(backer, t)}</Meta>
            <Meta>·</Meta>
            <View style={styles.inline}>
              {failed ? <Icon icon={Glyphs.Danger} size={14} color={colors.danger} /> : null}
              <Meta tone={failed ? 'primary' : 'tertiary'}>{t(`dashboard.states.${backer.state}`)}</Meta>
            </View>
            <Meta>·</Meta>
            <Meta>{backer.country ?? t('dashboard.charts.noDestination')}</Meta>
            <Meta>·</Meta>
            <Meta>{formatDate(backer.backedAt, locale)}</Meta>
          </View>
        </View>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  inner: { gap: spacing[3] },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  who: { flex: 1, gap: spacing[1] },
  amount: { fontVariant: ['tabular-nums'], flexShrink: 0, maxWidth: '45%', textAlign: 'right' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing[1], rowGap: spacing[1] },
});
