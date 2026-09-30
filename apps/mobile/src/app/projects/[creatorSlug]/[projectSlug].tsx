import { useMemo } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { siteUrl } from '../../../api/config';
import { useProjectPage, useProjectRewards, useProjectUpdates } from '../../../api/queries';
import { FadeUp } from '../../../components/motion';
import { ProgressBar } from '../../../components/progress';
import {
  Body,
  CardTitle,
  Display,
  Heading,
  Meta,
  Story,
  Subheading,
} from '../../../components/text';
import {
  InlineAlert,
  MotionBudgetProvider,
  Pill,
  Screen,
  Skeleton,
  SkeletonGroup,
} from '../../../components/ui';
import { formatCount, formatDate, pluralCategory, useT } from '../../../lib/i18n';
import { shareUrlFor } from '../../../lib/links';
import { useLocale } from '../../../lib/locale';
import { storyParagraphs } from '../../../lib/story';
import { colors, radius, size, spacing } from '../../../theme';

/**
 * The campaign page — §4.4 and §4.9. **Story, rewards, updates, comments, and a
 * persistent call to action.**
 *
 * <h2>Motion: moderate, and the call to action is pinned</h2>
 *
 * `docs/motion-system.md` §5 gives the project page the *moderate* budget —
 * story and transaction in balance — and the route declares it, so every kit
 * primitive under it reads the same level. The sections fade up as they arrive,
 * since this is still a reading surface, and the bar at the bottom never moves:
 * motion decreases as money gets closer. It is drawn once, outside the scroll
 * view, so it is on screen at the moment somebody decides rather than at the
 * moment they reach the end.
 *
 * <h2>Comments are read, not written</h2>
 *
 * §4.6's comment thread is a moderated surface with reporting, replies and rate
 * limits, and half of it is meaningless without an account this application
 * cannot yet create (see `lib/use-session.ts`). What is here is the count and a
 * link to the web thread — which is the honest version of "comments", rather
 * than a composer whose submit button cannot work.
 */

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface3 },
  body: { padding: size.cardPaddingLarge, gap: size.sectionGap },
  section: { gap: spacing[3] },
  figures: { flexDirection: 'row', gap: size.cardPaddingLarge, flexWrap: 'wrap' },
  figure: { gap: spacing[1] },
  reward: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[2],
  },
  update: { gap: spacing[1], paddingVertical: spacing[2] },
  placeholder: { gap: spacing[4], paddingTop: spacing[5] },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: size.cardPaddingSmall,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface2,
  },
  primary: { flex: 1 },
});

export default function ProjectScreen() {
  const { creatorSlug, projectSlug } = useLocalSearchParams<{
    creatorSlug: string;
    projectSlug: string;
  }>();
  const t = useT();
  const locale = useLocale();

  const project = useProjectPage(creatorSlug, projectSlug);
  const rewards = useProjectRewards(project.data?.id);
  const updates = useProjectUpdates(project.data?.id);

  const paragraphs = useMemo(() => storyParagraphs(project.data?.story), [project.data?.story]);

  if (project.data === undefined) {
    /*
     * Nothing cached and nothing yet: the page's shape while the first answer is on its way, and
     * otherwise the failure with a retry that asks again — the old state had no way out but back.
     */
    return (
      <Screen
        motion="moderate"
        hasContent={project.isLoading}
        error={
          project.isLoading
            ? null
            : {
                title: t('mobile.campaign.failedTitle'),
                description: t('mobile.campaign.failedDetail'),
                onRetry: () => void project.refetch(),
                retrying: project.isFetching,
              }
        }
      >
        <SkeletonGroup label={t('campaign.prelaunch.loading')}>
          <View style={styles.placeholder}>
            <Skeleton aspectRatio={16 / 9} radius="lg" />
            <Skeleton height={28} width="80%" />
            <Skeleton height={16} width="60%" />
            <Skeleton height={40} width="50%" />
            <Skeleton height={6} radius="lg" />
          </View>
        </SkeletonGroup>
      </Screen>
    );
  }

  const page = project.data;
  const title = page.title ?? t('mobile.campaign.untitled');
  const backers = page.backersCount ?? 0;
  const percent = fundedPercent(page.pledged?.amount, page.goal?.amount);

  return (
    <MotionBudgetProvider level="moderate">
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title, headerBackTitle: t('mobile.nav.back') }} />

        <ScrollView contentInsetAdjustmentBehavior="automatic">
          {page.coverImage?.url == null ? null : (
            <Image
              source={page.coverImage.url}
              style={styles.cover}
              contentFit="cover"
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          )}

          <View style={styles.body}>
            {/*
            The cached page, and a refetch that failed: shown, and said to be old. Read in its
            place rather than announced — the offline banner has already said the connection went.
          */}
            {project.isStale && project.isError ? (
              <InlineAlert
                variant="warning"
                politeness="polite"
                description={t('mobile.campaign.stale')}
              />
            ) : null}

            <FadeUp index={0}>
              <View style={styles.section}>
                <Heading>{title}</Heading>
                {page.blurb == null ? null : <Body>{page.blurb}</Body>}
                {page.creator?.name == null ? null : (
                  <Meta>{t('campaign.by', { creator: page.creator.name })}</Meta>
                )}
              </View>
            </FadeUp>

            <FadeUp index={1}>
              <View style={styles.section}>
                <View style={styles.figures}>
                  <View style={styles.figure}>
                    <Display>{formatMoney(page.pledged)}</Display>
                    <Meta>{t('common.card.ofGoal', { amount: formatMoney(page.goal) })}</Meta>
                  </View>
                  <View style={styles.figure}>
                    <Display>{formatCount(backers, locale)}</Display>
                    {/* The web's word under the figure: `{one, few, many, other}`, not ICU. */}
                    <Meta>{t(`campaign.funding.backers.${pluralCategory(locale, backers)}`)}</Meta>
                  </View>
                </View>
                <ProgressBar
                  completionPercent={percent}
                  label={t('mobile.funding.progressFor', { title })}
                />
              </View>
            </FadeUp>

            {paragraphs.length === 0 ? null : (
              <FadeUp index={2}>
                <View style={styles.section}>
                  <Subheading>{t('mobile.campaign.story')}</Subheading>
                  {paragraphs.map((paragraph, index) => (
                    <Story key={index}>{paragraph}</Story>
                  ))}
                  <Meta>{t('mobile.campaign.storyOnWeb')}</Meta>
                </View>
              </FadeUp>
            )}

            {(rewards.data?.rewards ?? []).length === 0 ? null : (
              <FadeUp index={3}>
                <View style={styles.section}>
                  <Subheading>{t('campaign.rewards.heading')}</Subheading>
                  {(rewards.data?.rewards ?? []).map((reward) => (
                    <View key={reward.id} style={styles.reward}>
                      <CardTitle>{reward.title ?? ''}</CardTitle>
                      <Meta tone="secondary">{formatMoney(reward.price)}</Meta>
                      {reward.description == null ? null : (
                        <Body numberOfLines={4}>{reward.description}</Body>
                      )}
                      {/* In words, because "6 left" in lime and "sold out" in grey
                        is colour carrying the difference on its own. */}
                      <Meta>
                        {reward.remainingQuantity == null
                          ? t('campaignEditor.rewards.vocabulary.stock.unlimited')
                          : reward.remainingQuantity === 0
                            ? t('campaign.rewards.soldOut')
                            : t('campaign.rewards.remaining', { count: reward.remainingQuantity })}
                      </Meta>
                    </View>
                  ))}
                </View>
              </FadeUp>
            )}

            {(updates.data?.updates ?? []).length === 0 ? null : (
              <FadeUp index={4}>
                <View style={styles.section}>
                  <Subheading>{t('campaign.updates.heading')}</Subheading>
                  {(updates.data?.updates ?? []).map((update) => (
                    <View key={update.number} style={styles.update}>
                      <CardTitle numberOfLines={2}>{update.title ?? ''}</CardTitle>
                      <Meta>{formatDate(update.publishedAt, locale)}</Meta>
                    </View>
                  ))}
                </View>
              </FadeUp>
            )}

            <View style={styles.section}>
              <Subheading>{t('campaign.comments.heading')}</Subheading>
              <Body>{t('mobile.campaign.commentsOnWeb')}</Body>
            </View>
          </View>
        </ScrollView>

        {/*
        Outside the ScrollView, so it does not scroll away. §5's minimal motion
        budget: it is drawn, it does not arrive.
      */}
        <View style={styles.actions}>
          {/*
            The page's one urgent action, so the one lime pill on it: backing the campaign is
            what "act now" means (docs/ui-kit.md §7.2). Its visible words are its name, so speech
            input reaches it by what it says; which campaign, and that it opens the web, is the
            hint. Share is an outline beside it.
          */}
          <View style={styles.primary}>
            <Pill
              label={t('campaign.back.cta')}
              accessibilityHint={t('mobile.campaign.backOnWeb', { title })}
              variant="accent"
              size="lg"
              fullWidth
              onPress={() => void openOnWeb(creatorSlug, projectSlug)}
            />
          </View>

          <Pill
            label={t('campaign.actions.share')}
            accessibilityHint={t('campaign.actions.shareLabel', { title })}
            variant="outline"
            size="lg"
            onPress={() => void share(title, creatorSlug, projectSlug)}
          />
        </View>
      </View>
    </MotionBudgetProvider>
  );
}

/**
 * Percent funded, computed here because `ProjectPageResponse` does not carry it.
 *
 * `Card` does — the feed's projection has `completionPercent` — and this one has
 * the two amounts instead. Both are decimal strings, so the division is done on
 * numbers only after the strings have been checked, and only to produce a bar
 * width and a rounded label. Nothing downstream treats the result as money.
 */
function fundedPercent(pledged: string | undefined, goal: string | undefined): string {
  if (pledged === undefined || goal === undefined) return '0';
  if (!/^\d+(\.\d+)?$/.test(pledged) || !/^\d+(\.\d+)?$/.test(goal)) return '0';

  const target = Number(goal);
  if (target <= 0) return '0';

  return ((Number(pledged) / target) * 100).toFixed(2);
}

async function openOnWeb(creatorSlug: string, projectSlug: string): Promise<void> {
  const { openBrowserAsync } = await import('expo-web-browser');
  await openBrowserAsync(shareUrlFor(siteUrl(), creatorSlug, projectSlug));
}

async function share(title: string, creatorSlug: string, projectSlug: string): Promise<void> {
  const url = shareUrlFor(siteUrl(), creatorSlug, projectSlug);
  /*
   * The https URL, never `ideanest://`. A recipient without the application
   * installed must be able to open what they were sent; the universal-link
   * association (§4.12 MB-02) is what makes the same string open the application for
   * everybody who does have it.
   */
  await Share.share({ message: `${title} — ${url}`, url, title });
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../../components/route-error-boundary';
