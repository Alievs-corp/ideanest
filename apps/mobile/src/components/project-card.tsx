import Decimal from 'decimal.js';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { Glyphs } from '../icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DiscoveryStatus } from '@ideanest/discovery/vocabulary';
import { formatMoney } from '@ideanest/money';
import { fillNodes } from '@ideanest/messages/placeholders';
import type { Card } from '../api/queries';
import { pluralCategory, useT } from '../lib/i18n';
import { useLocale } from '../lib/locale';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tint } from '../theme';
import { Body, CardTitle, Meta } from './text';
import { Icon, MediaFrame, ProgressBar, Tag, type IconComponent, type TagVariant } from './ui';

/**
 * One campaign in a list — the web's `components/discovery/ProjectCard.tsx`, field by field
 * (issue #153), and `docs/ui-kit.md` §7.1/§8.2. Home, Discover, Search, and the category and
 * collection screens all draw this one card.
 *
 * <h2>The whole card is one link with one name</h2>
 *
 * A thumb aims at the picture, so the `Pressable` wraps everything, takes the `link` role and is
 * named "title, by creator". A screen reader announces one link per campaign rather than the
 * cover, the title, the tags and the bar as separate stops — the web's stretched anchor, natively.
 *
 * An accessible parent swallows its children on iOS, so the facts the card prints — the status,
 * the countdown, the percent funded, the backers — are its `accessibilityValue`, read after the
 * name. The bar inside is decorative for the same reason: its figure is already in that value,
 * and as an element of its own it would be a second stop on Android and unreachable on iOS.
 *
 * <h2>Money is never a number</h2>
 *
 * `pledged` and `goal` are formatted from their digits by `@ideanest/money`, the web's own
 * module. `completionPercent` is read with `decimal.js` and rounded with `toFixed(0)`, so
 * "79.995" reads "80% funded" on both platforms. The only `number` is the bar's fill width,
 * which is geometry, not an amount.
 *
 * <h2>Lime is the urgency chip, and only that</h2>
 *
 * In the last two days of a live campaign a lime chip with near-black text says "hurry". It is
 * the one lime element on the card: a funded bar is `--success`, a successful badge is
 * `--success`, closing soon is `--warning`. Every tag is an icon plus a word, so no colour carries
 * a meaning alone.
 *
 * <h2>No entry animation</h2>
 *
 * Cards do not animate in (they live in unbounded lists, `mobile-design` skill §6.5); the progress
 * bar's rise and the press feedback are the motion on a card.
 */

/** Two days or fewer left — what §8.1 calls "closing within 48 hours". */
const URGENT_DAYS = 2;

interface BadgeSpec {
  readonly icon: IconComponent;
  readonly variant: TagVariant;
}

/**
 * The status words' icon and hue; the words are `discovery.card.badges`. `successful` is
 * `--success`, never lime. `extended` is in the record because it is keyed by every status, and
 * matches the tag below.
 */
const BADGES: Record<DiscoveryStatus, BadgeSpec> = {
  upcoming: { icon: Glyphs.Calendar, variant: 'default' },
  live: { icon: Glyphs.RecordCircle, variant: 'default' },
  extended: { icon: Glyphs.CalendarAdd, variant: 'default' },
  successful: { icon: Glyphs.TickCircle, variant: 'success' },
};

function isStatus(value: string | undefined): value is DiscoveryStatus {
  return value !== undefined && Object.hasOwn(BADGES, value);
}

/**
 * The completion figure as a decimal, or null.
 *
 * Absent for a campaign with no goal — every pre-launch row — and null for a malformed one: a
 * percentage of nothing is not zero, and "0%" would tell a backer a campaign raised none of a goal
 * it has not set.
 */
export function completionOf(card: Pick<Card, 'completionPercent'>): Decimal | null {
  const raw = card.completionPercent;
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  try {
    const value = new Decimal(raw);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

export interface ProjectCardProps {
  readonly card: Card;
  /**
   * Fetches the cover first. True for the first three cards of a list — the ones on screen when
   * it opens — and nothing else, so twenty-four covers do not share one priority queue.
   */
  readonly priority?: boolean;
}

export function ProjectCard({ card, priority = false }: ProjectCardProps) {
  const t = useT();
  const locale = useLocale();

  const title = card.title ?? t('mobile.campaign.untitled');
  const creator = card.creator?.name ?? '';
  const byline = creator === '' ? '' : t('discovery.card.by', { creator });
  const completion = completionOf(card);
  const percent = completion?.toFixed(0) ?? '';
  const status = isStatus(card.badge) ? card.badge : null;

  /*
   * `daysLeft` is the service's, computed against its clock, and rendered rather than recomputed:
   * a phone in the wrong timezone must not disagree with the web on the figure that makes somebody
   * hurry. It is zero once the deadline has passed, so zero counts only while the campaign is LIVE
   * — "Last day" on a campaign that closed a fortnight ago would be a lie, and lime a loud one.
   */
  const days = typeof card.daysLeft === 'number' ? card.daysLeft : null;
  const live = card.state === 'LIVE';
  const showDays = days !== null && (days > 0 || live);
  const urgent = showDays && live && days !== null && days <= URGENT_DAYS;
  /*
   * The bare count, as the web's `pluralise` writes it: "1234 backers" on both platforms rather
   * than the phone grouping the digits and the browser not.
   */
  const daysLabel =
    days === null
      ? ''
      : days === 0
        ? t('discovery.card.lastDay')
        : t(`discovery.card.daysLeft.${pluralCategory(locale, days)}`, { count: String(days) });

  const backers = card.backersCount ?? 0;
  const backersLabel = t(`common.card.backers.${pluralCategory(locale, backers)}`, {
    count: String(backers),
  });

  const tagged = status !== null || card.extended === true || card.closingSoon === true || urgent;

  /** What the card prints, in reading order, for the one element a screen reader stops on. */
  const facts = [
    status === null ? null : t(`discovery.card.badges.${status}`),
    card.extended === true ? t('discovery.card.badges.extended') : null,
    card.closingSoon === true ? t('discovery.card.badges.closing_soon') : null,
    urgent ? daysLabel : null,
    completion === null ? t('discovery.card.notOpen') : t('common.card.funded', { percent }),
    backersLabel,
    !urgent && showDays ? daysLabel : null,
  ].filter((fact): fact is string => fact !== null && fact !== '');

  return (
    <Link
      href={{
        pathname: '/projects/[creatorSlug]/[projectSlug]',
        params: { creatorSlug: card.creatorSlug ?? '', projectSlug: card.slug ?? '' },
      }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={byline === '' ? title : `${title}, ${byline}`}
        accessibilityValue={{ text: facts.join(', ') }}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        {/*
          The 16:9 box is reserved whether or not there is a cover, so every card in a list is the
          same height before anything decodes. The cover is decorative: the card's name already
          says what it is a picture of.
        */}
        <MediaFrame ratio="16/9">
          {card.image?.url === undefined ? null : (
            <Image
              source={{ uri: card.image.url }}
              style={styles.cover}
              contentFit="cover"
              priority={priority ? 'high' : 'normal'}
              transition={0}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          )}
        </MediaFrame>

        <View style={styles.body}>
          {tagged ? (
            <View style={styles.tags}>
              {status === null ? null : (
                <Tag
                  label={t(`discovery.card.badges.${status}`)}
                  icon={BADGES[status].icon}
                  variant={BADGES[status].variant}
                />
              )}
              {card.extended === true ? (
                <Tag label={t('discovery.card.badges.extended')} icon={Glyphs.CalendarAdd} />
              ) : null}
              {card.closingSoon === true ? (
                <Tag
                  label={t('discovery.card.badges.closing_soon')}
                  icon={Glyphs.Timer1}
                  variant="warning"
                />
              ) : null}
              {/*
                The last-48-hours countdown, and the one lime element on the card: a lime fill
                with near-black words. Lime text on a dark surface is what §9.1 forbids.
              */}
              {urgent ? (
                <Tag label={daysLabel} icon={Glyphs.Clock} variant="urgent" testID="urgency-chip" />
              ) : null}
            </View>
          ) : null}

          <CardTitle numberOfLines={2}>{title}</CardTitle>

          {creator === '' ? null : (
            <Body style={styles.byline}>
              {fillNodes(String(t.raw('discovery.card.by')), {
                creator: <Text style={styles.creator}>{creator}</Text>,
              })}
            </Body>
          )}

          {completion !== null ? (
            <View style={styles.funding}>
              {/*
                No words on the bar: the figure is printed beside it. The completion goes in as
                the decimal's own digits, unrounded, so 99.999 is not drawn as funded.
              */}
              <ProgressBar
                completionPercent={completion.toFixed()}
                label={t('common.card.progressLabel', { percent })}
                showLabel={false}
                decorative
              />
              <View style={styles.figures}>
                <Text style={styles.pledged}>{formatMoney(card.pledged)}</Text>
                <Text style={styles.funded}>{t('common.card.funded', { percent })}</Text>
              </View>
              <Meta tone="secondary" style={styles.small}>
                {t('common.card.rule')}
              </Meta>
              {card.goal == null ? null : (
                <Meta style={[styles.small, styles.tabular]}>
                  {t('common.card.ofGoal', { amount: formatMoney(card.goal) })}
                </Meta>
              )}
            </View>
          ) : (
            <Body tone="tertiary" style={styles.notOpen}>
              {t('discovery.card.notOpen')}
            </Body>
          )}

          <View style={styles.footer}>
            <View style={styles.fact}>
              <Icon icon={Glyphs.People} size={14} color={colors.textTertiary} />
              <Meta style={[styles.small, styles.tabular]}>{backersLabel}</Meta>
            </View>
            {/* Days left as text whenever it is not already the lime chip. */}
            {!urgent && showDays ? (
              <View style={styles.fact}>
                <Icon icon={Glyphs.Clock} size={14} color={colors.textTertiary} />
                <Meta style={[styles.small, styles.tabular]}>{daysLabel}</Meta>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.surface3 },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  body: { padding: size.cardPaddingSmall, gap: spacing[3] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  byline: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  // The web's `text-white/80` on the name: white at 80%, derived from the token.
  creator: { color: tint(colors.textPrimary, 0.8) },
  funding: { gap: spacing[2], paddingTop: spacing[2] },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing[3],
    rowGap: spacing[1],
  },
  pledged: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  funded: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  small: { ...font.regular },
  tabular: { fontVariant: ['tabular-nums'] },
  notOpen: { fontSize: fontSize.sm, lineHeight: lineHeight.small, paddingTop: spacing[2] },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing[4] },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
});
