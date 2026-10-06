import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ApiError } from '@ideanest/api-client';
import {
  describeStatus,
  isFollowableTrackingUrl,
  type BackerFulfilment,
  type StatusDescription,
} from '@ideanest/account/fulfilment';
import {
  Body,
  Card,
  ContentSheet,
  EmptyState,
  Heading,
  Meta,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
  Subheading,
  Tag,
  type IconComponent,
} from '../../components/ui';
import { FadeUp, useFirstScreenfulIndex } from '../../components/motion';
import { traceIdOfError } from '../../api/client';
import { Glyphs } from '../../icons';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { catalogue, formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { spacing } from '../../theme';
import { useDeliveries } from './deliveries-api';
import { TextLink } from './text-link';

const PLACEHOLDER_CARDS = [0, 1, 2] as const;
/** The web's 7rem placeholder: a title, a sentence and a line of facts. */
const PLACEHOLDER_HEIGHT = 112;

/** The glyph beside each status's word, so the tone is never carried by colour alone. */
const STATUS_ICON: Record<StatusDescription['tone'], IconComponent> = {
  default: Glyphs.Box,
  warning: Glyphs.Truck,
  success: Glyphs.TickCircle,
  danger: Glyphs.Warning2,
};

/**
 * Where each reward is — the web's `DeliveryList` at `/account/deliveries`.
 *
 * One card per pledge, the campaign as its heading (or "no longer listed" for a removed one: it
 * still owes a parcel). The tracking URL is the creator's text: it becomes a link only when
 * `isFollowableTrackingUrl` passes (http or https), and opens in the in-app browser, never through
 * `Linking.openURL`; anything else is shown as text. The address link is on every card. The
 * service does not page the list; it is persisted (`lib/offline.ts`) and read from there offline.
 */
export function DeliveriesScreen() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.deliveries.signedOutTitle')}
            description={t('mobile.deliveries.signedOutBody')}
            action={
              <Pill label={t('shell.actions.signIn')} onPress={() => router.push(signInHrefFor('/account/deliveries'))} />
            }
          />
        }
      />
    );
  }
  return <DeliveryList />;
}

function DeliveryList() {
  const router = useRouter();
  const t = useT();
  const online = useOnline();
  const query = useDeliveries(true);
  const rows = query.data;
  const [pulling, setPulling] = useState(false);
  const entryIndex = useFirstScreenfulIndex((rows ?? []).map(rowKey));

  const nothing = rows === undefined;
  const unreachable = nothing && (query.fetchStatus === 'paused' || (!online && query.isError));
  const loading = nothing && query.isPending && !unreachable;
  const failure = query.error;

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{t('account.pages.deliveries.title')}</Heading>
      <Body>{t('account.pages.deliveries.intro')}</Body>
    </View>
  );

  return (
    <Screen
      testID="deliveries"
      hasContent={loading || (rows?.length ?? 0) > 0}
      onRefresh={() => {
        setPulling(true);
        void query.refetch().finally(() => setPulling(false));
      }}
      refreshing={pulling}
      offlineNotice={!nothing && (!online || query.isRefetchError) ? t('mobile.deliveries.stale') : null}
      error={
        nothing && (query.isError || unreachable)
          ? {
              title: t('account.fulfilment.deliveries.failedTitle'),
              description: unreachable
                ? t('mobile.offline.nothingCached')
                : failure instanceof ApiError
                  ? (failure.problem?.detail ?? failure.problem?.title ?? t('account.fulfilment.deliveries.refused'))
                  : t('account.fulfilment.deliveries.unreachable'),
              onRetry: () => void query.refetch(),
              retrying: query.isFetching,
              traceId: traceIdOfError(failure),
            }
          : null
      }
      empty={
        <View style={styles.emptyWrap}>
          {header}
          <EmptyState
            icon={Glyphs.Box}
            title={t('account.fulfilment.deliveries.emptyTitle')}
            description={t('account.fulfilment.deliveries.emptyBody')}
            action={
              <Pill label={t('account.fulfilment.deliveries.emptyAction')} onPress={() => router.push('/discover')} />
            }
            testID="deliveries-empty"
          />
        </View>
      }
    >
      {header}
      <ContentSheet>
        {loading ? (
          <SkeletonGroup label={t('account.fulfilment.deliveries.loading')} testID="deliveries-loading">
            <View style={styles.cards}>
              {PLACEHOLDER_CARDS.map((card) => (
                <Skeleton key={card} height={PLACEHOLDER_HEIGHT} radius="lg" />
              ))}
            </View>
          </SkeletonGroup>
        ) : (
          <View style={styles.cards}>
            {(rows ?? []).map((row) => (
              <FadeUp key={rowKey(row)} index={entryIndex(rowKey(row))}>
                <DeliveryCard row={row} />
              </FadeUp>
            ))}
          </View>
        )}
      </ContentSheet>
    </Screen>
  );
}

function rowKey(row: BackerFulfilment): string {
  return row.fulfilment.pledgeId;
}

function present(value: string | null): value is string {
  return value !== null && value !== '';
}

/** One parcel. Exported for its tests. */
export function DeliveryCard({ row }: { readonly row: BackerFulfilment }) {
  const router = useRouter();
  const t = useT('account.fulfilment.deliveries');
  const tAll = useT();
  const locale = useLocale();
  const tables = catalogue(locale).account.fulfilment;
  const state = describeStatus(row.fulfilment.status, { status: tables.status, statusDetail: tables.statusDetail });
  const { carrier, trackingNumber, trackingUrl, shippedAt, deliveredAt, pledgeId } = row.fulfilment;
  const followable = isFollowableTrackingUrl(trackingUrl);
  const id = `delivery-${pledgeId}`;

  const hasFacts = [carrier, trackingNumber, shippedAt, deliveredAt].some(present);

  return (
    <Card size="md" testID={id}>
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Subheading accessibilityRole="header">{row.projectTitle ?? t('unlisted')}</Subheading>
            <Body>{state.detail}</Body>
          </View>
          <Tag label={state.label} variant={state.tone} icon={STATUS_ICON[state.tone]} testID={`${id}-status`} />
        </View>

        {hasFacts ? (
          <View style={styles.facts}>
            {present(carrier) ? <Fact label={t('carrier')} value={carrier} /> : null}
            {present(trackingNumber) ? (
              followable && trackingUrl !== null ? (
                <View style={styles.fact}>
                  <Meta>{t('tracking')}</Meta>
                  <TextLink
                    label={trackingNumber}
                    accessibilityHint={tAll('mobile.deliveries.trackingHint')}
                    onPress={() => void WebBrowser.openBrowserAsync(trackingUrl.trim())}
                    testID={`${id}-tracking-link`}
                  />
                </View>
              ) : (
                <Fact label={t('tracking')} value={trackingNumber} testID={`${id}-tracking-text`} />
              )
            ) : null}
            {present(shippedAt) ? <Fact label={t('sent')} value={formatDateTime(shippedAt, locale)} /> : null}
            {present(deliveredAt) ? <Fact label={t('arrived')} value={formatDateTime(deliveredAt, locale)} /> : null}
          </View>
        ) : null}

        <View style={styles.links}>
          <TextLink
            label={t('shippingAddress')}
            icon={Glyphs.Location}
            onPress={() => router.push({ pathname: '/pledges/[id]/address', params: { id: pledgeId } })}
            testID={`${id}-address`}
          />
          {present(row.creatorSlug) && present(row.projectSlug) ? (
            <TextLink
              label={t('theCampaign')}
              quiet
              onPress={() =>
                router.push({
                  pathname: '/projects/[creatorSlug]/[projectSlug]',
                  params: { creatorSlug: row.creatorSlug ?? '', projectSlug: row.projectSlug ?? '' },
                })
              }
              testID={`${id}-campaign`}
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

/** One line of the web's definition list: read as "Carrier, DHL". */
function Fact({ label, value, testID }: { readonly label: string; readonly value: string; readonly testID?: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}, ${value}`} testID={testID}>
      <Meta>{label}</Meta>
      <Body selectable style={styles.value}>
        {value}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing[2], paddingTop: spacing[4], paddingBottom: spacing[2] },
  emptyWrap: { gap: spacing[6] },
  cards: { gap: spacing[3] },
  card: { gap: spacing[4] },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[3] },
  headText: { flexShrink: 1, flexGrow: 1, gap: spacing[1] },
  facts: { gap: spacing[2] },
  fact: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing[2] },
  value: { flexShrink: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[5] },
});
