import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@ideanest/api-client';
import { needsAnAnswer } from '@ideanest/account/surveys';
import {
  Body,
  ContentSheet,
  EmptyState,
  Heading,
  InlineAlert,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
} from '../../components/ui';
import { FadeUp, useFirstScreenfulIndex } from '../../components/motion';
import { traceIdOfError } from '../../api/client';
import { Glyphs } from '../../icons';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { pluralCategory, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { colors, spacing } from '../../theme';
import { useSurveys } from './api';
import { SurveyCard } from './survey-card';
import { keepOrder, surveyKey } from './survey-form';

const PLACEHOLDER_CARDS = [0, 1] as const;
/** The web's 12rem placeholder, a card's worth of questions. */
const PLACEHOLDER_HEIGHT = 192;

/**
 * Every survey this account is being asked — the web's `SurveyList` at `/account/surveys`.
 *
 * The service returns whole surveys, so they are answered in place. What is still owed comes
 * first, with a warning that counts the creators waiting. Nothing is polled; pull to refresh. The
 * list is persisted (`lib/offline.ts`), so offline it shows the last copy and every Save is
 * disabled with the reason — answers are never queued.
 *
 * The page is a `ScrollView` rather than a virtualised list: a survey is a form, a handful at
 * most, and a recycled cell would drop a half-typed answer. A `KeyboardAvoidingView` keeps the
 * focused field above the keyboard on iOS; Android resizes the window itself.
 */
export function SurveysScreen() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();

  if (!signedIn) {
    return (
      <Screen
        hasContent={false}
        empty={
          <EmptyState
            title={t('mobile.surveys.signedOutTitle')}
            description={t('mobile.surveys.signedOutBody')}
            action={
              <Pill label={t('shell.actions.signIn')} onPress={() => router.push(signInHrefFor('/account/surveys'))} />
            }
          />
        }
      />
    );
  }
  return <SurveyList />;
}

function SurveyList() {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const online = useOnline();
  const query = useSurveys(true);
  const surveys = query.data;
  const [pulling, setPulling] = useState(false);

  const order = useRef<readonly string[] | null>(null);
  const ordered = surveys === undefined ? [] : keepOrder(order.current, surveys);
  order.current = surveys === undefined ? null : ordered.map(surveyKey);
  const entryIndex = useFirstScreenfulIndex(ordered.map(surveyKey));
  const waiting = (surveys ?? []).filter(needsAnAnswer).length;

  const nothing = surveys === undefined;
  const unreachable = nothing && (query.fetchStatus === 'paused' || (!online && query.isError));
  const loading = nothing && query.isPending && !unreachable;
  const failure = query.error;

  function refresh() {
    order.current = null;
    setPulling(true);
    void query.refetch().finally(() => setPulling(false));
  }

  const header = (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{t('account.pages.surveys.title')}</Heading>
      <Body>{t('account.pages.surveys.intro')}</Body>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        testID="surveys"
        hasContent={loading || ordered.length > 0}
        onRefresh={refresh}
        refreshing={pulling}
        offlineNotice={!nothing && (!online || query.isRefetchError) ? t('mobile.surveys.stale') : null}
        error={
          nothing && (query.isError || unreachable)
            ? {
                title: t('account.surveys.list.failedTitle'),
                description: unreachable
                  ? t('mobile.offline.nothingCached')
                  : failure instanceof ApiError
                    ? (failure.problem?.detail ?? failure.problem?.title ?? t('account.surveys.list.refused'))
                    : t('account.surveys.list.unreachable'),
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
              icon={Glyphs.DocumentText}
              title={t('account.surveys.list.emptyTitle')}
              description={t('account.surveys.list.emptyBody')}
              action={<Pill label={t('common.browseCampaigns')} onPress={() => router.push('/discover')} />}
              testID="surveys-empty"
            />
          </View>
        }
      >
        {header}
        <ContentSheet>
          {loading ? (
            <SkeletonGroup label={t('account.surveys.list.loading')} testID="surveys-loading">
              <View style={styles.cards}>
                {PLACEHOLDER_CARDS.map((card) => (
                  <Skeleton key={card} height={PLACEHOLDER_HEIGHT} radius="lg" />
                ))}
              </View>
            </SkeletonGroup>
          ) : (
            <View style={styles.cards}>
              {waiting > 0 ? (
                <InlineAlert
                  variant="warning"
                  title={t(`account.surveys.list.waitingTitle.${pluralCategory(locale, waiting)}`, {
                    count: String(waiting),
                  })}
                  description={t('account.surveys.list.waitingBody')}
                  politeness="polite"
                  testID="surveys-waiting"
                />
              ) : null}
              {ordered.map((survey) => (
                <FadeUp key={surveyKey(survey)} index={entryIndex(surveyKey(survey))}>
                  <SurveyCard
                    survey={survey}
                    online={online}
                    onAddress={(id) => router.push({ pathname: '/pledges/[id]/address', params: { id } })}
                  />
                </FadeUp>
              ))}
            </View>
          )}
        </ContentSheet>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  header: { gap: spacing[2], paddingTop: spacing[4], paddingBottom: spacing[2] },
  emptyWrap: { gap: spacing[6] },
  cards: { gap: spacing[4] },
});
