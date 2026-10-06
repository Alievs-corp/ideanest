import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  isPayoutState,
  payoutInstant,
  type CampaignFinance,
  type FinancePayout,
  type PayoutState,
} from '@ideanest/dashboard/finance';
import { formatMoney } from '@ideanest/money';
import { traceIdOfError } from '../../../api/client';
import {
  Body,
  Caption,
  CardTitle,
  ContentSheet,
  EmptyState,
  Heading,
  InlineAlert,
  Meta,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  StatBlock,
  StatRow,
  TONES,
  Tag,
  type TagVariant,
} from '../../../components/ui';
import { BLOCK } from '../../../components/ui/surface';
import { FadeUp } from '../../../components/motion';
import { useOnline } from '../../../lib/connectivity';
import { signInHrefFor } from '../../../lib/guard';
import { formatDateTime, useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { useSession } from '../../../lib/use-session';
import { colors, font, fontSize, lineHeight, radius, spacing, tint } from '../../../theme';
import { sectionOf, usePullToRefresh, type Refusal } from '../shared-charts-finance';
import { useFinance } from './api';

const EDGES = ['left', 'right', 'bottom'] as const;
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** The web's three placeholders: a heading's line, the stats and the deductions. */
const PLACEHOLDERS = [
  { key: 'heading', height: 32, width: '66%' },
  { key: 'stats', height: 96, width: '100%' },
  { key: 'deductions', height: 160, width: '100%' },
] as const;

/** The state's colour is a reminder; the tag's word is the fact. */
const PAYOUT_TAG: Record<PayoutState, TagVariant> = {
  CALCULATED: 'default',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'default',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'default',
};

/**
 * `campaigns/[id]/dashboard/finance` — the web's `FinancialSummary` (#163): gross, what came off
 * it, what is payable, the payouts and the ledger behind them. Read only.
 *
 * <p>Every figure is the service's string through `formatMoney`; nothing is added up here, not
 * even to check the others. Projected and settled are labelled in words, because before a payout
 * is calculated the fees are what the schedule would charge and afterwards what it did. The
 * figures sit on the dark canvas; the breakdown, the payouts and the books are lists, in the white
 * sheet.
 */
export function FinancePanel({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const router = useRouter();
  const { signedIn } = useSession();

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        edges={EDGES}
        empty={
          <EmptyState
            title={t('dashboard.finance.heading')}
            description={t('dashboard.failures.signedOut')}
            action={
              <Pill
                label={t('shell.actions.signIn')}
                onPress={() => router.push(signInHrefFor(`/campaigns/${projectId}/dashboard/finance`))}
              />
            }
          />
        }
      />
    );
  }
  return <Panel projectId={projectId} />;
}

function Panel({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const online = useOnline();
  const query = useFinance(projectId);
  const state = sectionOf(query, online);
  const pull = usePullToRefresh([query.refetch]);

  const failure = (refusal: Refusal) =>
    ({
      signedOut: t('dashboard.failures.signedOut'),
      notGranted: t('dashboard.finance.notGranted'),
      noCampaign: t('dashboard.failures.noCampaign'),
      unavailable: t('dashboard.finance.unavailable'),
    })[refusal];

  return (
    <Screen
      hasContent={state.kind === 'ready' || state.kind === 'loading'}
      edges={EDGES}
      onRefresh={pull.onRefresh}
      refreshing={pull.refreshing}
      offlineNotice={state.kind === 'ready' && state.stale ? t('mobile.dashboardFigures.stale') : null}
      error={
        state.kind === 'failed' || state.kind === 'unreachable'
          ? {
              title: t('dashboard.finance.heading'),
              description:
                state.kind === 'unreachable' ? t('mobile.offline.nothingCached') : failure(state.refusal),
              onRetry: () => void query.refetch(),
              retrying: query.isFetching,
              traceId: state.kind === 'failed' ? traceIdOfError(state.error) : null,
            }
          : null
      }
      testID="dashboard-finance"
    >
      {state.kind === 'ready' ? (
        <Summary finance={state.data} />
      ) : (
        <SkeletonGroup label={t('dashboard.finance.loading')} testID="finance-loading">
          <View style={styles.placeholders}>
            {PLACEHOLDERS.map((block) => (
              <Skeleton key={block.key} height={block.height} width={block.width} radius="lg" />
            ))}
          </View>
        </SkeletonGroup>
      )}
    </Screen>
  );
}

function Summary({ finance }: { readonly finance: CampaignFinance }) {
  const t = useT('dashboard.finance');
  const locale = useLocale();
  const projected = finance.basis === 'PROJECTED';

  return (
    <>
      <FadeUp index={0}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Heading accessibilityRole="header">{t('heading')}</Heading>
            <Tag label={projected ? t('projected') : t('settled')} testID="finance-basis" />
          </View>
          <Body>{projected ? t('projectedIntro') : t('settledIntro')}</Body>
        </View>
      </FadeUp>
      <FadeUp index={1}>
        <StatRow>
          <StatBlock size="md" label={t('gross')} value={formatMoney(finance.gross)} />
          <StatBlock size="md" label={projected ? t('netProjected') : t('net')} value={formatMoney(finance.net)} />
          <StatBlock size="md" label={t('paidOut')} value={formatMoney(finance.paidOut)} />
        </StatRow>
      </FadeUp>
      <ContentSheet title={t('deductionsHeading')} testID="finance-sheet">
          <View accessibilityLabel={t('deductionsCaption')} >
            <AmountRow label={t('grossCollected')} amount={formatMoney(finance.gross)} />
            <AmountRow label={t('platformFee')} amount={`− ${formatMoney(finance.platformFee)}`} />
            <AmountRow label={t('processingFee')} amount={`− ${formatMoney(finance.processingFee)}`} />
            <AmountRow
              label={t('taxWithheld')}
              amount={`− ${formatMoney(finance.taxWithheld)}`}
              // A bare zero would read as "no tax is due", which the platform cannot say.
              note={finance.taxCollected ? undefined : t('taxNote')}
            />
            <AmountRow label={t('refunded')} amount={`− ${formatMoney(finance.refunded)}`} />
            <AmountRow
              label={projected ? t('payableProjected') : t('payable')}
              amount={formatMoney(finance.net)}
              total
            />
          </View>

          <View style={styles.block}>
            <CardTitle accessibilityRole="header">{t('payoutsHeading')}</CardTitle>
            {finance.payouts.length === 0 ? (
              <Body testID="payouts-empty">{t('payoutsEmpty')}</Body>
            ) : (
              <View style={styles.cards}>
                {finance.payouts.map((payout) => (
                  <PayoutCard key={payout.id} payout={payout} locale={locale} />
                ))}
              </View>
            )}
          </View>

          <View style={styles.block}>
            <CardTitle accessibilityRole="header">{t('booksHeading')}</CardTitle>
            <Body>{t('booksIntro')}</Body>
            {finance.reconciled ? null : (
              <InlineAlert
                variant="warning"
                title={t('unbalancedTitle')}
                description={t('unbalancedBody')}
                politeness="polite"
                testID="finance-unbalanced"
              />
            )}
            {finance.ledger.length === 0 ? (
              <Body testID="ledger-empty">{t('ledgerEmpty')}</Body>
            ) : (
              <View accessibilityLabel={t('ledgerCaption')} >
                <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                  <Meta>{t('account')}</Meta>
                  <Meta>{t('balance')}</Meta>
                </View>
                {finance.ledger.map((balance) => (
                  <View
                    key={`${balance.account}-${balance.net.currency}`}
                    accessible
                    accessibilityLabel={`${t('account')} ${balance.account}, ${t('balance')} ${formatMoney(balance.net)}`}
                    style={[styles.row, styles.rule]}
                  >
                    <Text style={[styles.account, { color: TONES.white.secondary }]}>{balance.account}</Text>
                    <Text style={[styles.amount, { color: TONES.white.primary }]}>{formatMoney(balance.net)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {finance.computedAt === null ? null : (
            <Caption testID="finance-as-of">{t('asOf', { time: formatDateTime(finance.computedAt, locale) })}</Caption>
          )}
      </ContentSheet>
    </>
  );
}

/** One line of the deductions. `total` is the line a reader adds up to, under a rule. */
function AmountRow({
  label,
  amount,
  note,
  total = false,
}: {
  readonly label: string;
  readonly amount: string;
  readonly note?: string | undefined;
  readonly total?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={note === undefined ? `${label}, ${amount}` : `${label}, ${amount}. ${note}`}
      style={[styles.row, total ? styles.totalRule : styles.rule]}
    >
      <View style={styles.label}>
        <Text style={[styles.rowLabel, total ? styles.strong : null, { color: TONES.white[total ? 'primary' : 'secondary'] }]}>
          {label}
        </Text>
        {note === undefined ? null : <Meta tone="secondary">{note}</Meta>}
      </View>
      <Text style={[styles.amount, total ? styles.strong : null, { color: TONES.white.primary }]}>{amount}</Text>
    </View>
  );
}

function PayoutCard({ payout, locale }: { readonly payout: FinancePayout; readonly locale: ReturnType<typeof useLocale> }) {
  const t = useT('dashboard.finance.payoutStates');
  const when = payoutInstant(payout);
  const known = isPayoutState(payout.state) ? payout.state : null;
  const state = known === null ? payout.state : t(known);
  const date = when === null ? '' : formatDateTime(when, locale);
  const amount = formatMoney(payout.net);

  return (
    <View
      accessible
      accessibilityLabel={[state, date, amount].filter((part) => part !== '').join(', ')}
      style={styles.card}
      testID={`payout-${payout.id}`}
    >
      <View style={styles.cardStart}>
        <Tag label={state} variant={known === null ? 'default' : PAYOUT_TAG[known]} />
        {date === '' ? null : <Meta tone="secondary">{date}</Meta>}
      </View>
      <Text style={[styles.amount, { color: TONES.white.primary }]}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholders: { gap: spacing[4], paddingTop: spacing[4] },
  header: { gap: spacing[3], paddingTop: spacing[4] },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  block: { gap: spacing[3], paddingTop: spacing[4] },
  cards: { gap: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[4],
    paddingVertical: spacing[3],
  },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tint(colors.textOnWhite, 0.08) },
  totalRule: { borderTopWidth: 1, borderTopColor: tint(colors.textOnWhite, 0.16) },
  label: { flexShrink: 1, gap: spacing[1] },
  rowLabel: { ...font.medium, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  amount: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  strong: { ...font.semibold },
  account: { flexShrink: 1, fontFamily: MONO, fontSize: fontSize.caption, lineHeight: lineHeight.small },
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: BLOCK.white.rest,
  },
  cardStart: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3], flexShrink: 1 },
});
