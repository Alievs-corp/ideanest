import { Pressable, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { windowFacts, type Collection } from '@ideanest/discovery/collections';
import { formatWindowDate, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { Body, CardTitle } from '../text';
import { MediaFrame } from '../ui';
import { CollectionFacts } from './collection-facts';
import { KindTag, useKindLabel } from './collection-kind';

/**
 * One collection in the index — the web's `CollectionCard`
 * (`components/collections/CollectionCard.tsx`), issue #154.
 *
 * In `ProjectCard`'s style and for its reasons: surface-2 with a hairline border and the large
 * radius, surface-3 while pressed, and the whole card one link — one stop and one announcement
 * per collection, which the web gets from a stretched anchor and a phone from a `Pressable`.
 *
 * Top to bottom: a 16:9 cover whose box is reserved with or without an image, so every card is the
 * same height before anything decodes; the kind tag, with no tag for a kind this build does not
 * know; the title; the standfirst when the curator wrote one; and the facts — how many campaigns,
 * then when it closes, then since when it is open.
 *
 * The cover is decorative: the title is the card's name and nothing here could describe the
 * picture that the curator did not already write.
 *
 * <h2>No entry animation</h2>
 *
 * docs/motion-system.md §8 forbids animation in lists. Only the pressed colour changes.
 */
export function CollectionCard({
  collection,
  priority = false,
}: {
  readonly collection: Collection;
  /** Fetches the cover first. True for the first three cards and nothing else. */
  readonly priority?: boolean;
}) {
  const t = useT('discovery.collections');
  const locale = useLocale();
  const kind = useKindLabel(collection.kind);
  const campaigns = String(collection.projectCount);

  /** What the card prints, in reading order, for the one element a screen reader stops on. */
  const facts = [
    kind,
    collection.description,
    `${t('cardCampaigns')} ${campaigns}`,
    ...windowFacts(
      collection,
      { closes: t('window.closes'), openSince: t('window.openSince') },
      (iso) => formatWindowDate(iso, locale),
    ).map((fact) => `${fact.term} ${fact.date}`),
  ].filter((fact): fact is string => fact !== null && fact !== '');

  return (
    <Link
      href={{ pathname: '/collections/[slug]', params: { slug: collection.slug } }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={collection.title}
        accessibilityValue={{ text: facts.join(', ') }}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        testID="collection-card"
      >
        <MediaFrame ratio="16/9">
          {collection.image === null ? null : (
            <Image
              source={{ uri: collection.image.url }}
              style={styles.cover}
              contentFit="cover"
              priority={priority ? 'high' : 'normal'}
              transition={0}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="collection-cover"
            />
          )}
        </MediaFrame>

        <View style={styles.body}>
          {kind === null ? null : (
            <View style={styles.tag}>
              <KindTag kind={collection.kind} />
            </View>
          )}
          <CardTitle>{collection.title}</CardTitle>
          {collection.description === null || collection.description === '' ? null : (
            <Body style={styles.description}>{collection.description}</Body>
          )}
          <View style={styles.facts}>
            <CollectionFacts
              collection={collection}
              first={{ term: t('cardCampaigns'), value: campaigns }}
            />
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
  tag: { flexDirection: 'row' },
  description: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  facts: { paddingTop: spacing[2] },
});
