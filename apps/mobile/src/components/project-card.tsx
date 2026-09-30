import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Card } from '../api/queries';
import { useT } from '../lib/i18n';
import { colors, radius, size, spacing } from '../theme';
import { Body, CardTitle, Meta } from './text';
import { ProgressBar } from './progress';

/**
 * One campaign in a list — `docs/ui-kit.md` §7.1.
 *
 * <h2>The whole card is the target</h2>
 *
 * Not a "View campaign" link under the text. A thumb on a phone aims at the
 * picture, and a card whose only target is a line of 14px text is a card people
 * miss. The `Link` wraps everything and carries the accessible name, so a screen
 * reader announces one link with the campaign's title rather than four
 * unlabelled fragments.
 *
 * <h2>Money is a string all the way to the screen</h2>
 *
 * `formatMoney` comes from `@ideanest/money`, which is the same module
 * `apps/web` formats with. That is the point of the package: `0.1 + 0.2 !== 0.3`
 * is somebody's pledge, and two implementations of the rounding rule are two
 * places for one of them to drift.
 */

export interface ProjectCardProps {
  readonly card: Card;
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
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface3 },
  body: { padding: size.cardPaddingSmall, gap: spacing[3] },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
});

export function ProjectCard({ card }: ProjectCardProps) {
  const t = useT();
  const title = card.title ?? t('mobile.campaign.untitled');
  const creator = card.creator?.name ?? '';
  const pledged = formatMoney(card.pledged);

  /*
   * `daysLeft` is a number the service computed against its own clock, and it is
   * rendered rather than recomputed here for that reason: a phone with a wrong
   * timezone would otherwise disagree with the web about how long is left, on
   * the one figure that makes somebody hurry.
   */
  const daysLeft = card.daysLeft;

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
        // One name for the whole card. Without it a reader announces the image,
        // the title, the creator and the progress bar as four separate items.
        accessibilityLabel={
          creator === '' ? title : `${title}, ${t('discovery.card.by', { creator })}`
        }
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <Image
          source={card.image?.url}
          style={styles.cover}
          contentFit="cover"
          // Decorative: the card's own accessible name already says what this
          // is a picture of, and a second announcement of the same title is
          // noise rather than description.
          accessibilityElementsHidden
          importantForAccessibility="no"
          transition={0}
        />

        <View style={styles.body}>
          <CardTitle numberOfLines={2}>{title}</CardTitle>
          {creator === '' ? null : <Body numberOfLines={1}>{creator}</Body>}

          <ProgressBar
            completionPercent={card.completionPercent ?? '0'}
            label={t('mobile.funding.progressFor', { title })}
          />

          <View style={styles.footer}>
            <Meta>{pledged === '' ? '' : t('mobile.funding.pledged', { amount: pledged })}</Meta>
            {typeof daysLeft === 'number' ? (
              // The campaign page's ICU plural, so the last day reads "Last day" on both.
              <Meta>{t('campaign.daysLeft', { days: daysLeft })}</Meta>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
