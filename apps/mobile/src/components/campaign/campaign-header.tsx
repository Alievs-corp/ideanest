import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Glyphs } from '../../icons';
import type { ProjectState } from '@ideanest/campaign/states';
import { fillNodes } from '@ideanest/messages/placeholders';
import type { CampaignPage } from '../../lib/campaign-page';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tracking } from '../../theme';
import { Body } from '../text';
import { Tag, useFocusRing, type IconComponent, type TagVariant } from '../ui';

/**
 * Blocks 2–4 — the web's `CampaignSummary` above the figures: the tag row, the title and blurb,
 * and the byline (#155).
 *
 * <h2>Colour</h2>
 *
 * Lime is urgency and nothing else (docs/ui-kit.md §2.4, §8.1). The urgency chip — LIVE with two
 * days or fewer — is **the only lime element on this page**, a lime fill with on-lime text, never
 * lime text. A funded campaign is `success`. Every tag is a hue, an icon and a word together, so
 * the colour is never the only thing that says which (§9.2).
 */

/** Under two days left — ui-kit §8.1's "closing within 48 hours", the web's `URGENT_DAYS`. */
export const URGENT_DAYS = 2;

interface StateBadge {
  /** A key under `campaign.state`. COLLECTING and WITHDRAWN read as funded, as on the web. */
  readonly labelKey: keyof typeof STATE_KEYS;
  readonly icon: IconComponent;
  readonly variant: TagVariant;
}

/** The catalogue's state words, as a type, so a badge cannot name a key that does not exist. */
const STATE_KEYS = {
  PRELAUNCH: true,
  LIVE: true,
  SUCCESSFUL: true,
  COLLECTING: true,
  LATE_PLEDGE: true,
  FULFILLING: true,
  COMPLETED: true,
  UNSUCCESSFUL: true,
  CANCELED: true,
  CLOSING_WINDOW: true,
  EXTENDED: true,
  WITHDRAWN: true,
} as const;

/** The web's `BADGES`, state for state: the word, the icon and the variant (#155's table). */
export const STATE_BADGES: Partial<Record<ProjectState, StateBadge>> = {
  PRELAUNCH: { labelKey: 'PRELAUNCH', icon: Glyphs.Calendar, variant: 'default' },
  LIVE: { labelKey: 'LIVE', icon: Glyphs.RecordCircle, variant: 'default' },
  SUCCESSFUL: { labelKey: 'SUCCESSFUL', icon: Glyphs.TickCircle, variant: 'success' },
  COLLECTING: { labelKey: 'SUCCESSFUL', icon: Glyphs.TickCircle, variant: 'success' },
  LATE_PLEDGE: { labelKey: 'LATE_PLEDGE', icon: Glyphs.Timer1, variant: 'warning' },
  FULFILLING: { labelKey: 'FULFILLING', icon: Glyphs.Timer1, variant: 'success' },
  COMPLETED: { labelKey: 'COMPLETED', icon: Glyphs.TickCircle, variant: 'success' },
  UNSUCCESSFUL: { labelKey: 'UNSUCCESSFUL', icon: Glyphs.Slash, variant: 'default' },
  CANCELED: { labelKey: 'CANCELED', icon: Glyphs.Slash, variant: 'default' },
  CLOSING_WINDOW: { labelKey: 'CLOSING_WINDOW', icon: Glyphs.Timer1, variant: 'warning' },
  EXTENDED: { labelKey: 'EXTENDED', icon: Glyphs.CalendarAdd, variant: 'default' },
  WITHDRAWN: { labelKey: 'WITHDRAWN', icon: Glyphs.TickCircle, variant: 'success' },
};

/**
 * Whether the page counts days down at all: LIVE with a deadline that has not passed at `now` (the
 * page's clock, `lib/campaign-clock.ts`). `daysLeft` is floored at zero, so a campaign that closed
 * a fortnight ago and one closing tonight report the same number, and "Last day" on the first
 * would be a loud lie — so would "Last day" on a campaign whose deadline passed a minute ago while
 * the service has not yet moved its state on.
 */
export function showsDaysLeft(campaign: CampaignPage, now: Date): boolean {
  if (campaign.state !== 'LIVE' || campaign.daysLeft === null || campaign.deadline === null) {
    return false;
  }
  return Date.parse(campaign.deadline) > now.getTime();
}

export function CampaignHeader({
  campaign,
  now,
}: {
  readonly campaign: CampaignPage;
  /** The page's clock — see `showsDaysLeft`. */
  readonly now: Date;
}) {
  const t = useT();
  const router = useRouter();
  const badge = STATE_BADGES[campaign.state];
  const urgent =
    showsDaysLeft(campaign, now) && campaign.daysLeft !== null && campaign.daysLeft <= URGENT_DAYS;
  const byline = t('campaign.by', { creator: campaign.creator.name });

  return (
    <View style={styles.header}>
      <View style={styles.tags} testID="campaign-tags">
        {badge === undefined ? null : (
          <Tag
            label={t(`campaign.state.${badge.labelKey}`)}
            icon={badge.icon}
            variant={badge.variant}
            testID="campaign-state"
          />
        )}

        {urgent && campaign.daysLeft !== null ? (
          <Tag
            label={t('campaign.daysLeft', { days: campaign.daysLeft })}
            icon={Glyphs.Clock}
            variant="urgent"
            testID="campaign-urgency"
          />
        ) : null}

        {campaign.category === null ? null : (
          <TextLink
            label={campaign.category.name}
            onPress={() =>
              router.push({
                pathname: '/discover',
                params: { category: campaign.category?.slug ?? '' },
              })
            }
            testID="campaign-category"
          >
            <Text style={styles.category}>{campaign.category.name}</Text>
          </TextLink>
        )}
      </View>

      <View style={styles.titleBlock}>
        <Text accessibilityRole="header" style={styles.title} testID="campaign-title">
          {campaign.title}
        </Text>
        {campaign.blurb === null ? null : <Body tone="reading">{campaign.blurb}</Body>}
      </View>

      {/*
        One sentence with the name in it, because none of the other three languages has English's
        "by" before the name. The whole line is the link — a name alone is too small a target —
        and its accessible name is the sentence, so it is read once.
      */}
      <TextLink
        label={byline}
        onPress={() => router.push({ pathname: '/discover', params: { q: campaign.creator.name } })}
        testID="campaign-byline"
      >
        <Text style={styles.byline}>
          {fillNodes(String(t.raw('campaign.by')), {
            creator: <Text style={styles.creator}>{campaign.creator.name}</Text>,
          })}
        </Text>
      </TextLink>
    </View>
  );
}

/** Hit slop above and below a line of small text, so its target is 44pt and its row is not. */
const LINK_REACH = Math.max(0, (size.touchTarget - lineHeight.small) / 2);

/**
 * A line of small text that navigates: a 44pt target however small the words (the reach is hit
 * slop, so the tag row keeps its height), the kit's focus ring, and one accessible name.
 */
function TextLink({
  label,
  onPress,
  children,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hitSlop={{ top: LINK_REACH, bottom: LINK_REACH }}
      style={({ pressed }) => [styles.link, pressed && styles.pressed, ring]}
      testID={testID}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing[5] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  category: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  titleBlock: { gap: spacing[2] },
  title: {
    ...font.semibold,
    fontSize: fontSize.h1,
    lineHeight: lineHeight.h1,
    letterSpacing: tracking.h1,
    color: colors.textPrimary,
  },
  byline: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  creator: { color: colors.textPrimary, textDecorationLine: 'underline' },
  link: { alignSelf: 'flex-start', borderRadius: radius.sm },
  pressed: { opacity: 0.64 },
});
