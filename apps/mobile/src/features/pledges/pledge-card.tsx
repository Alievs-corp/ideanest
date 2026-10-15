import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { chargeNoteOf, pledgeTone, type PledgeTone } from '@ideanest/checkout/pledge';
import { Avatar, Body, Card, CardTitle, Meta, Tag, type IconComponent } from '../../components/ui';
import { Glyphs } from '../../icons';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { readablePledgeState } from '../../lib/pledge-states';
import { spacing } from '../../theme';
import type { BackerPledgeSummary } from './api';

export interface PledgeCardProps {
  readonly pledge: BackerPledgeSummary;
  readonly onOpen: (pledgeId: string) => void;
}

/** The glyph beside a state's word, so the tone is never carried by colour alone. */
export const STATE_ICON: Record<PledgeTone, IconComponent> = {
  success: Glyphs.TickCircle,
  warning: Glyphs.Clock,
  default: Glyphs.InfoCircle,
};

/**
 * One pledge in the list: a row block in the white content sheet (`mobile-design` skill §2), the
 * campaign's cover as its avatar, the total on the right and the state as an icon-and-word tag.
 * The `Card` gives it the press scale and the white surface's muted block.
 */
export function PledgeCard({ pledge, onOpen }: PledgeCardProps) {
  const t = useT('account.pledges');
  const tMobile = useT();
  const locale = useLocale();
  const state = pledge.state ?? '';
  const title = pledge.project?.title ?? tMobile('mobile.campaign.untitled');
  const stateLabel = readablePledgeState(state, locale);
  const total = formatMoney(pledge.amounts?.total);
  const note = chargeNoteOf(state);
  const tone = pledgeTone(state);
  const creator = pledge.project?.creatorSlug;
  const moment =
    pledge.canceledAt != null
      ? t('list.cancelledAt', { time: formatDateTime(pledge.canceledAt, locale) })
      : pledge.confirmedAt != null
        ? t('list.confirmedAt', { time: formatDateTime(pledge.confirmedAt, locale) })
        : null;
  const byline = creator == null ? null : t('list.byCreator', { creator });
  const details = [byline, moment].filter((part): part is string => part !== null);
  const id = pledge.pledgeId;
  const refundPending = pledge.refundAwaitingBankTransfer != null;

  return (
    <Card
      size="sm"
      accessibilityRole="link"
      accessibilityLabel={[
        title,
        stateLabel,
        total,
        pledge.isAnonymous === true ? t('anonymous') : null,
        refundPending ? t('list.refundPending') : null,
        note === null ? null : t(`list.${note}`),
        pledge.rewardTitle ?? t('list.noReward'),
        ...details,
      ]
        .filter((part): part is string => part !== null)
        .join(', ')}
      disabled={id === undefined}
      onPress={() => {
        if (id !== undefined) onOpen(id);
      }}
      testID={`pledge-card-${id ?? ''}`}
    >
      <View style={styles.inner}>
        <View style={styles.top}>
          <Avatar name={title} src={pledge.project?.coverImage?.url} decorative />
          <View style={styles.text}>
            <CardTitle numberOfLines={2}>{title}</CardTitle>
            <Body numberOfLines={1}>{pledge.rewardTitle ?? t('list.noReward')}</Body>
          </View>
        </View>
        {details.length === 0 ? null : (
          <View style={styles.details}>
            {details.map((line) => (
              <Meta key={line} tone="tertiary" numberOfLines={2}>
                {line}
              </Meta>
            ))}
          </View>
        )}
        <View style={styles.footer}>
          <View style={styles.tags}>
            <Tag label={stateLabel} variant={tone} icon={STATE_ICON[tone]} />
            {pledge.isAnonymous === true ? <Tag label={t('anonymous')} icon={Glyphs.EyeSlash} /> : null}
            {refundPending ? (
              <Tag label={t('list.refundPending')} variant="warning" icon={Glyphs.MoneyRecive} />
            ) : null}
          </View>
          <View style={styles.amount}>
            <CardTitle numberOfLines={1} style={styles.total}>
              {total}
            </CardTitle>
            {note === null ? null : (
              <Meta tone="tertiary" numberOfLines={1}>
                {t(`list.${note}`)}
              </Meta>
            )}
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  inner: { gap: spacing[3] },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  text: { flex: 1, gap: spacing[1] },
  details: { gap: spacing[1] },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing[3] },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  amount: { alignItems: 'flex-end', gap: spacing[1], flexShrink: 0 },
  total: { fontVariant: ['tabular-nums'] },
});
