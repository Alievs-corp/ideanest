import { Pressable, StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { chargeNoteOf, pledgeTone } from '@ideanest/checkout/pledge';
import { Body, CardTitle, Meta, Tag } from '../../components/ui';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { readablePledgeState } from '../../lib/pledge-states';
import { colors, radius, size, spacing } from '../../theme';
import type { BackerPledgeSummary } from './api';

export interface PledgeCardProps {
  readonly pledge: BackerPledgeSummary;
  readonly onOpen: (pledgeId: string) => void;
}

export function PledgeCard({ pledge, onOpen }: PledgeCardProps) {
  const t = useT('account.pledges');
  const tMobile = useT();
  const locale = useLocale();
  const state = pledge.state ?? '';
  const title = pledge.project?.title ?? tMobile('mobile.campaign.untitled');
  const stateLabel = readablePledgeState(state, locale);
  const total = formatMoney(pledge.amounts?.total);
  const note = chargeNoteOf(state);
  const creator = pledge.project?.creatorSlug;
  const moment =
    pledge.canceledAt != null
      ? t('list.cancelledAt', { time: formatDateTime(pledge.canceledAt, locale) })
      : pledge.confirmedAt != null
        ? t('list.confirmedAt', { time: formatDateTime(pledge.confirmedAt, locale) })
        : null;
  const byline = [creator == null ? null : t('list.byCreator', { creator }), moment]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const id = pledge.pledgeId;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[title, stateLabel, total].join(', ')}
      disabled={id === undefined}
      onPress={() => {
        if (id !== undefined) onOpen(id);
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`pledge-card-${id ?? ''}`}
    >
      <View style={styles.top}>
        <View style={styles.text}>
          <CardTitle numberOfLines={2}>{title}</CardTitle>
          <Body numberOfLines={2}>{pledge.rewardTitle ?? t('list.noReward')}</Body>
          {byline === '' ? null : <Meta tone="tertiary">{byline}</Meta>}
        </View>
        <View style={styles.amount}>
          <CardTitle style={styles.total}>{total}</CardTitle>
          {note === null ? null : <Meta tone="tertiary">{t(`list.${note}`)}</Meta>}
        </View>
      </View>
      <View style={styles.tags}>
        <Tag label={stateLabel} variant={pledgeTone(state)} />
        {pledge.isAnonymous === true ? <Tag label={t('anonymous')} /> : null}
        {pledge.latePledge === true ? <Tag label={t('latePledge')} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[3],
    minHeight: size.touchTarget,
  },
  pressed: { backgroundColor: colors.surface3 },
  top: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing[3] },
  text: { flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: spacing[1] },
  amount: { alignItems: 'flex-end', gap: spacing[1] },
  total: { fontVariant: ['tabular-nums'] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
