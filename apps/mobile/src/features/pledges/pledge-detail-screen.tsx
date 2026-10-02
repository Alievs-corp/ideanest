import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import { approximate, formatMoney } from '@ideanest/money';
import { describeFailure } from '@ideanest/checkout/failure';
import {
  isDisputable,
  isEditable,
  isRaisable,
  isSettling,
  pledgeTone,
  quotedRate,
  readReturnHint,
  type PaymentReturnHint,
} from '@ideanest/checkout/pledge';
import type { PledgeResponse } from '@ideanest/checkout/types';
import {
  Body,
  Heading,
  InlineAlert,
  Meta,
  MotionBudgetProvider,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  Subheading,
  Tag,
  haptics,
} from '../../components/ui';
import { queryKeys } from '../../api/queries';
import { useAppActive } from '../../lib/app-active';
import { useOnline } from '../../lib/connectivity';
import { catalogue, formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { readablePledgeState } from '../../lib/pledge-states';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tint } from '../../theme';
import { countryName } from '../checkout/format';
import { PledgeSummary } from '../checkout/pledge-summary';
import { readPledge } from './api';
import { findMyPledge } from './campaign-lookup';
import { DisputeForm } from './dispute-form';
import { PaymentReturnNotice, RaiseReturnNotice } from './return-notice';
import { usePaymentSettling } from './use-payment-settling';
import { cachedPledgeSummaries, type PledgePages } from './use-pledge-list';

export interface PledgeDetailScreenProps {
  readonly id: string;
  readonly payment?: unknown;
  readonly raise?: unknown;
  readonly renderEditor?: (pledge: PledgeResponse, options: EditorSlot) => ReactNode;
}

export interface EditorSlot {
  readonly disabled: boolean;
  readonly raising: boolean;
  readonly onSaved: (next: PledgeResponse) => void;
  readonly onReload: () => void;
  readonly onRaiseReturned: (hint: PaymentReturnHint | null) => void;
}

interface Hints {
  readonly payment: PaymentReturnHint | null;
  readonly raise: PaymentReturnHint | null;
  readonly epoch: number;
}

export function PledgeDetailScreen(props: PledgeDetailScreenProps) {
  return (
    <MotionBudgetProvider level="none">
      <PledgeDetail {...props} />
    </MotionBudgetProvider>
  );
}

function PledgeDetail({ id, payment, raise, renderEditor }: PledgeDetailScreenProps) {
  const router = useRouter();
  const client = useQueryClient();
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const active = useAppActive();
  const [hints, setHints] = useState<Hints>({ payment: null, raise: null, epoch: 0 });
  const paymentHint = hints.payment;
  const raiseHint = hints.raise;

  useEffect(() => {
    if (payment === undefined && raise === undefined) return;
    const next = { payment: readReturnHint(payment), raise: readReturnHint(raise) };
    if (next.payment !== null || next.raise !== null) {
      setHints((current) => ({ ...next, epoch: current.epoch + 1 }));
    }
    router.setParams({ payment: undefined, raise: undefined });
  }, [payment, raise, router]);

  const query = useQuery({
    queryKey: queryKeys.pledge(id),
    queryFn: ({ signal }) => readPledge(id, signal),
  });
  const pledge = query.data;

  const campaign = useQuery({
    queryKey: [...queryKeys.pledge(id), 'campaign'] as const,
    enabled: pledge !== undefined,
    retry: false,
    queryFn: ({ signal }) =>
      findMyPledge(id, cachedPledgeSummaries(client.getQueryData<PledgePages>(queryKeys.pledgeList())), signal).catch(
        () => null,
      ),
  });
  const summary = campaign.data ?? null;

  const settling = pledge !== undefined && isSettling(pledge, paymentHint, raiseHint);
  const { refetch } = query;
  const reread = useCallback(() => refetch({ cancelRefetch: false }), [refetch]);
  usePaymentSettling(settling, active && online, reread, hints.epoch);

  const celebrated = useRef(0);
  useEffect(() => {
    if (celebrated.current === hints.epoch || pledge === undefined) return;
    const paid = paymentHint !== null && pledge.state === 'COLLECTED';
    const raised = raiseHint !== null && pledge.latestRaise?.state === 'SUCCEEDED';
    if (!paid && !raised) return;
    celebrated.current = hints.epoch;
    if (paid) haptics.pledgeConfirmed();
    void client.invalidateQueries({ queryKey: queryKeys.pledges() });
  }, [client, hints.epoch, paymentHint, pledge, raiseHint]);

  const slot = useMemo(
    () => ({
      onSaved: (next: PledgeResponse) => {
        client.setQueryData(queryKeys.pledge(id), next);
        void client.invalidateQueries({ queryKey: queryKeys.pledgeList() });
      },
      onReload: () => void reread(),
      onRaiseReturned: (hint: PaymentReturnHint | null) => {
        if (hint !== null) setHints((current) => ({ payment: null, raise: hint, epoch: current.epoch + 1 }));
        void reread();
      },
    }),
    [client, id, reread],
  );

  const [pulling, setPulling] = useState(false);
  const failure = useMemo(
    () => (query.isError ? describeFailure(query.error, catalogue(locale).checkout.failures) : null),
    [query.isError, query.error, locale],
  );
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  const allPledges = (
    <View style={styles.start}>
      <Pill variant="outline" label={t('account.pledges.manager.allPledges')} onPress={() => router.navigate('/pledges')} />
    </View>
  );

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{t('account.pages.pledgeDetail.title')}</Heading>
      <Body>{t('account.pages.pledgeDetail.intro')}</Body>
    </View>
  );

  if (pledge === undefined) {
    return (
      <Screen hasContent>
        <View style={styles.stack}>
          {header}
          {query.isError ? (
            <>
              <InlineAlert
                variant="danger"
                title={failure?.title ?? t('account.pledges.manager.unreadableTitle')}
                description={failure?.detail ?? t('account.pledges.manager.unreadableBody')}
                politeness="assertive"
                action={
                  notFound ? undefined : (
                    <Pill
                      size="sm"
                      variant="ghost"
                      label={t('common.tryAgain')}
                      busy={query.isFetching}
                      onPress={() => void refetch()}
                    />
                  )
                }
                testID="pledge-failed"
              />
              {allPledges}
            </>
          ) : (
            <SkeletonGroup label={t('account.pledges.manager.loading')}>
              <View style={styles.stack}>
                <Skeleton height={128} />
                <Skeleton height={224} />
              </View>
            </SkeletonGroup>
          )}
        </View>
      </Screen>
    );
  }

  const stateLabel = readablePledgeState(pledge.state, locale);
  const destination = pledge.shippingCountry == null ? null : countryName(pledge.shippingCountry, locale);
  const rewardTitle =
    summary?.rewardTitle ?? (pledge.rewardTierId == null ? null : t('checkout.summary.rewardLine'));
  const project = summary?.project;
  const editable = isEditable(pledge.state);
  const raisable = isRaisable(pledge);

  return (
    <Screen
      hasContent
      offlineNotice={online ? null : t('mobile.offline.banner')}
      onRefresh={() => {
        setPulling(true);
        void refetch().finally(() => setPulling(false));
      }}
      refreshing={pulling}
    >
      <View style={styles.stack}>
        {header}

        {paymentHint === null ? null : <PaymentReturnNotice hint={paymentHint} state={pledge.state} />}
        {raiseHint === null ? null : <RaiseReturnNotice hint={raiseHint} raise={pledge.latestRaise} />}

        <View style={styles.card}>
          {project?.title != null && project.creatorSlug != null && project.slug != null ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                router.push({
                  pathname: '/projects/[creatorSlug]/[projectSlug]',
                  params: { creatorSlug: project.creatorSlug ?? '', projectSlug: project.slug ?? '' },
                })
              }
              style={styles.titleLink}
              testID="pledge-campaign"
            >
              <Subheading accessibilityRole="header">{project.title}</Subheading>
            </Pressable>
          ) : (
            <Subheading accessibilityRole="header" testID="pledge-campaign-unnamed">
              {t('account.pledges.manager.campaignUnnamed')}
            </Subheading>
          )}

          <View style={styles.tags}>
            <Tag label={stateLabel} variant={pledgeTone(pledge.state)} testID="pledge-state" />
            {pledge.isAnonymous ? <Tag label={t('account.pledges.anonymous')} /> : null}
            {pledge.latePledge ? <Tag label={t('account.pledges.latePledge')} /> : null}
          </View>

          {pledge.confirmedAt == null ? null : (
            <Meta tone="tertiary">
              {t('account.pledges.manager.confirmedAt', { time: formatDateTime(pledge.confirmedAt, locale) })}
            </Meta>
          )}
          {pledge.canceledAt == null ? null : (
            <Meta tone="tertiary">
              {t('account.pledges.manager.withdrawnAt', { time: formatDateTime(pledge.canceledAt, locale) })}
            </Meta>
          )}

          <PledgeSummary
            amounts={pledge.amounts}
            source="quoted"
            rewardTitle={rewardTitle}
            destination={destination}
            waiting="pending"
            approximateTotal={approximate(pledge.amounts.total, quotedRate(pledge))}
          >
            {destination === null ? undefined : (
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/pledges/[id]/address', params: { id: pledge.id } })}
                style={styles.whereGoing}
                testID="pledge-where-going"
              >
                <Text style={styles.whereGoingText}>{t('account.pledges.manager.whereGoing')}</Text>
              </Pressable>
            )}
          </PledgeSummary>

          {pledge.supplements.length === 0 ? null : (
            <View style={styles.supplements} testID="pledge-supplements">
              <Subheading accessibilityRole="header">{t('account.pledges.manager.supplementsHeading')}</Subheading>
              {pledge.supplements.map((supplement) => (
                <View key={supplement.id} style={styles.supplementRow}>
                  <Body style={styles.supplementLabel}>
                    {supplement.kind === 'UPGRADE'
                      ? t('account.pledges.manager.upgrade')
                      : t('account.pledges.manager.extraAddons')}
                    {' · '}
                    {formatDateTime(supplement.createdAt, locale)}
                  </Body>
                  <Body style={styles.money}>{formatMoney(supplement.amount)}</Body>
                </View>
              ))}
              <Meta tone="tertiary">{t('account.pledges.manager.supplementsNote')}</Meta>
            </View>
          )}
        </View>

        {editable || raisable ? (
          (renderEditor?.(pledge, { ...slot, disabled: !online, raising: !editable }) ?? null)
        ) : (
          <InlineAlert
            variant="info"
            title={t('account.pledges.manager.lockedTitle')}
            description={t('account.pledges.manager.lockedBody', { state: stateLabel })}
            politeness="off"
            testID="pledge-locked"
          />
        )}

        {isDisputable(pledge.state) ? <DisputeForm pledgeId={pledge.id} disabled={!online} /> : null}

        {allPledges}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing[6], paddingVertical: spacing[4] },
  header: { gap: spacing[2] },
  start: { alignItems: 'flex-start' },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[3],
  },
  titleLink: { minHeight: size.touchTarget, justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  whereGoing: { minHeight: size.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
  whereGoingText: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: tint(colors.textOnWhite, 0.64),
    textDecorationLine: 'underline',
  },
  supplements: {
    gap: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing[4],
  },
  supplementRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing[3] },
  supplementLabel: { flexShrink: 1 },
  money: { fontVariant: ['tabular-nums'], color: colors.textPrimary },
});
