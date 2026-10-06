import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { formatMoney } from '@ideanest/money';
import { Glyphs } from '../../icons';
import { pluralCategory, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import {
  Body,
  CardTitle,
  Icon,
  MediaFrame,
  Meta,
  PressableScale,
  ProgressBar,
  TONES,
  Tag,
  useFocusRing,
  useSurface,
  type IconComponent,
  type TagVariant,
} from '../../components/ui';
import { BLOCK, blockSurface } from '../../components/ui/surface';
import { completionOf } from './format';
import type { ProfileProjectCard as Card } from './wire';

/**
 * One campaign on a profile — the web's `ProfileCampaignCard` (#156). Not the discovery card: it
 * has a blurb, no days left, no urgency chip and, on the Backed list, no money at all.
 *
 * <h2>Backed withholds every amount</h2>
 *
 * A public list of the campaigns a named person funded, with figures beside them, is a financial
 * profile they never published. So `funding="withheld"` draws neither the amount raised nor a
 * percentage nor a bar, and announces none — only an empty spacer, so the cards keep one height. It
 * is a required prop: a new caller has to say which list it is drawing. The backer count stays on
 * both lists: it is public on the campaign itself and is not a figure about this person.
 *
 * <h2>One link, one name</h2>
 *
 * The whole card is one press-scale link named by the title; what it prints — the state, the
 * funding when shown, the backers — is its `accessibilityValue`, so the bar inside is decorative.
 * Every state is an icon and a word; funded and completed take `success`, never lime, and there is
 * no lime anywhere on the card (it sits in the white sheet, where the bar's fill is dark).
 */

interface StateSpec {
  readonly icon: IconComponent;
  readonly variant: TagVariant;
}

/** The nine publicly visible states. Anything else is drawn as its own raw value. */
const STATES: Readonly<Record<string, StateSpec>> = {
  PRELAUNCH: { icon: Glyphs.Calendar, variant: 'default' },
  SCHEDULED: { icon: Glyphs.Calendar, variant: 'default' },
  LIVE: { icon: Glyphs.RecordCircle, variant: 'default' },
  SUCCESSFUL: { icon: Glyphs.TickCircle, variant: 'success' },
  UNSUCCESSFUL: { icon: Glyphs.Slash, variant: 'default' },
  COLLECTING: { icon: Glyphs.Timer1, variant: 'warning' },
  LATE_PLEDGE: { icon: Glyphs.Timer1, variant: 'warning' },
  FULFILLING: { icon: Glyphs.Box, variant: 'default' },
  COMPLETED: { icon: Glyphs.TickCircle, variant: 'success' },
};

type KnownState =
  | 'PRELAUNCH'
  | 'SCHEDULED'
  | 'LIVE'
  | 'SUCCESSFUL'
  | 'UNSUCCESSFUL'
  | 'COLLECTING'
  | 'LATE_PLEDGE'
  | 'FULFILLING'
  | 'COMPLETED';

function isKnown(state: string): state is KnownState {
  return Object.hasOwn(STATES, state);
}

export interface ProfileCampaignCardProps {
  readonly card: Card;
  /** `'withheld'` on the Backed list, always. */
  readonly funding: 'shown' | 'withheld';
  readonly onOpen: (card: Card) => void;
  /** Fetches the cover first: the first three cards. */
  readonly priority?: boolean;
}

export const ProfileCampaignCard = memo(function ProfileCampaignCard({
  card,
  funding,
  onOpen,
  priority = false,
}: ProfileCampaignCardProps) {
  const t = useT();
  const locale = useLocale();
  const ring = useFocusRing();
  const surface = useSurface();
  const block = BLOCK[blockSurface(surface)];
  const tone = TONES[surface];

  const stateLabel = isKnown(card.state) ? t(`profile.card.states.${card.state}`) : card.state;
  const spec = isKnown(card.state) ? STATES[card.state] : undefined;

  const completion =
    funding === 'shown' && card.goal !== null && card.pledged !== null
      ? completionOf(card.goal.amount, card.pledged.amount)
      : null;
  const percent = completion?.toFixed(0) ?? '';
  const pledged = completion === null ? '' : formatMoney(card.pledged);
  const goal = completion === null ? '' : t('common.card.ofGoal', { amount: formatMoney(card.goal) });
  const backers = t(`common.card.backers.${pluralCategory(locale, card.backersCount)}`, {
    count: String(card.backersCount),
  });

  const facts = [
    stateLabel,
    completion === null ? null : t('common.card.funded', { percent }),
    completion === null ? null : pledged,
    completion === null ? null : goal,
    backers,
  ].filter((fact): fact is string => fact !== null && fact !== '');

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={card.title}
      accessibilityValue={{ text: facts.join(', ') }}
      onPress={() => onOpen(card)}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      contentStyle={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? block.pressed : block.rest },
        ring.ring,
      ]}
      testID={`profile-card-${card.id}`}
    >
      {/* The box is reserved with or without a cover; the picture is decorative. */}
      <MediaFrame ratio="16/9" radius="lg">
        {card.coverUrl === null ? null : (
          <Image
            source={{ uri: card.coverUrl }}
            style={styles.cover}
            contentFit="cover"
            priority={priority ? 'high' : 'normal'}
            transition={0}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}
      </MediaFrame>

      <View style={styles.tag}>
        {spec === undefined ? (
          <Tag label={stateLabel} testID="profile-card-state" />
        ) : (
          <Tag label={stateLabel} icon={spec.icon} variant={spec.variant} testID="profile-card-state" />
        )}
      </View>

      <CardTitle>{card.title}</CardTitle>

      {card.blurb === null ? null : <Body numberOfLines={2} style={styles.blurb}>{card.blurb}</Body>}

      {completion === null ? (
        <View style={styles.spacer} testID="profile-card-no-funding" />
      ) : (
        <View style={styles.funding} testID="profile-card-funding">
          <ProgressBar
            completionPercent={completion.toFixed()}
            label={t('common.card.progressLabel', { percent })}
            showLabel={false}
            decorative
          />
          <View style={styles.figures}>
            <Text style={[styles.pledged, { color: tone.primary }]}>{pledged}</Text>
            <Text style={[styles.funded, { color: tone.secondary }]}>
              {t('common.card.funded', { percent })}
            </Text>
          </View>
          <Meta style={styles.tabular}>{goal}</Meta>
        </View>
      )}

      <View style={styles.backers}>
        <Icon icon={Glyphs.People} size={14} color={tone.tertiary} />
        <Meta style={styles.tabular}>{backers}</Meta>
      </View>
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: spacing[3],
    padding: size.cardPaddingSmall,
    borderRadius: radius.xl,
  },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  tag: { flexDirection: 'row' },
  blurb: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  spacer: { paddingTop: spacing[2] },
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
    fontVariant: ['tabular-nums'],
  },
  funded: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    fontVariant: ['tabular-nums'],
  },
  tabular: { fontVariant: ['tabular-nums'] },
  backers: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
});
