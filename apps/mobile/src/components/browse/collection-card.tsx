import { StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { windowFacts, type Collection } from '@ideanest/discovery/collections';
import { formatWindowDate, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { fontSize, lineHeight, radius, spacing } from '../../theme';
import { accentFor } from '../project-card';
import { Body, CardTitle } from '../text';
import { AccentCard, MediaFrame, PressableScale, useFocusRing } from '../ui';
import { CollectionFacts } from './collection-facts';
import { KindTag, useKindLabel } from './collection-kind';

/**
 * One collection in the index — the web's `CollectionCard`
 * (`components/collections/CollectionCard.tsx`), issue #154.
 *
 * In `ProjectCard`'s style and for its reasons: an `AccentCard` (`mobile-design` skill §2, §4)
 * whose accent is hashed from the collection (`accentFor`), so it keeps its colour wherever it is
 * drawn — a decoration, never a meaning — and the whole card one link with the press give
 * (`PressableScale`): one stop and one announcement per collection, which the web gets from a
 * stretched anchor.
 *
 * Top to bottom: a 16:9 cover whose box is reserved with or without an image, so every card is the
 * same height before anything decodes; the kind tag, with no tag for a kind this build does not
 * know; the title; the standfirst when the curator wrote one; and the facts — how many campaigns,
 * then when it closes, then since when it is open.
 *
 * The cover is decorative: the title is the card's name and nothing here could describe the
 * picture that the curator did not already write.
 *
 * <h2>Motion</h2>
 *
 * The press gives. The entry rise belongs to the index that draws the card, which knows whether
 * it is the first screenful.
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
  const ring = useFocusRing();
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
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={collection.title}
        accessibilityValue={{ text: facts.join(', ') }}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        contentStyle={[styles.target, ring.ring]}
        testID="collection-card"
      >
        <AccentCard
          accent={accentFor({ id: collection.id, slug: collection.slug, title: collection.title })}
        >
          <MediaFrame ratio="16/9" radius="lg">
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
        </AccentCard>
      </PressableScale>
    </Link>
  );
}

const styles = StyleSheet.create({
  target: { borderRadius: radius.xl },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  body: { gap: spacing[3] },
  tag: { flexDirection: 'row' },
  description: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  facts: { paddingTop: spacing[2] },
});
