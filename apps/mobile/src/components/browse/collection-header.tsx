import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Glyphs } from '../../icons';
import { isCollectionKind, isOpenCall, type Collection } from '@ideanest/discovery/collections';
import { pluralCategory, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { Body, Heading } from '../text';
import { Icon, MediaFrame, Skeleton } from '../ui';
import { Breadcrumb } from './breadcrumb';
import { CollectionFacts } from './collection-facts';
import { KindTag } from './collection-kind';

/**
 * The head of a collection's page — the web's `CollectionHeader`
 * (`components/collections/CollectionHeader.tsx`), issue #154. It is the list's header, so it
 * scrolls away with the campaigns rather than pinning above them.
 *
 * Top to bottom, as the web reads below `lg`: the trail; the kind tag; the title; the curator's
 * standfirst; the kind's own sentence; the facts (how many campaigns, when it closes, since when
 * it is open); the editorial-badge sentence when membership grants one; and the cover **after the
 * text**, full width — so what a screen reader reads, in order, is what the eye sees.
 *
 * A kind this build does not know has neither a tag nor a sentence. The dates are dates and never
 * a countdown: the response may be a minute old, and on an open call a wrong deadline is the
 * expensive mistake. Nothing here moves.
 */
export function CollectionHeader({ collection }: { readonly collection: Collection }) {
  const t = useT('discovery.collections');
  const tAll = useT();
  const locale = useLocale();
  const known = isCollectionKind(collection.kind);
  const count = tAll(
    `discovery.collections.count.${pluralCategory(locale, collection.projectCount)}`,
    { count: String(collection.projectCount) },
  );

  return (
    <View style={styles.header} testID="collection-header">
      <Breadcrumb
        label={tAll('common.breadcrumb')}
        crumbs={[
          { label: tAll('common.trail.collections'), href: '/collections' },
          { label: collection.title },
        ]}
        testID="breadcrumb"
      />

      <View style={styles.text}>
        {known ? (
          <View style={styles.tag}>
            <KindTag kind={collection.kind} />
          </View>
        ) : null}

        <Heading accessibilityRole="header">{collection.title}</Heading>

        {collection.description === null || collection.description === '' ? null : (
          <Body>{collection.description}</Body>
        )}

        {known ? (
          <Text style={styles.sentence} testID="collection-sentence">
            {t(`sentences.${collection.kind as 'themed'}`)}
          </Text>
        ) : null}
      </View>

      <CollectionFacts
        collection={collection}
        first={{ term: t('inCollection'), value: count }}
        gap="header"
        testID="collection-facts"
      />

      {collection.grantsBadge ? (
        <View style={styles.badge} testID="collection-badge">
          <Icon icon={Glyphs.Verify} size={16} color={colors.textTertiary} />
          <Text style={styles.badgeText}>
            {t('badge')} {isOpenCall(collection) ? t('badgeOpenCall') : t('badgeCurated')}
          </Text>
        </View>
      ) : null}

      {collection.image === null ? null : (
        <MediaFrame ratio="16/9" radius="lg" testID="collection-cover">
          <Image
            source={{ uri: collection.image.url }}
            style={styles.cover}
            contentFit="cover"
            priority="high"
            transition={0}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </MediaFrame>
      )}
    </View>
  );
}

/** The header before the collection arrives: the tag, the title, two lines, the facts, a cover. */
export function CollectionHeaderSkeleton() {
  return (
    <View style={styles.header}>
      <Skeleton height={lineHeight.small} width="40%" radius="sm" />
      <View style={styles.text}>
        <Skeleton height={spacing[6]} width={spacing[24]} radius="sm" />
        <Skeleton height={lineHeight.h2} width="70%" radius="sm" />
        <Skeleton height={lineHeight.body} width="95%" radius="sm" />
        <Skeleton height={lineHeight.body} width="80%" radius="sm" />
      </View>
      <Skeleton height={lineHeight.small} width="60%" radius="sm" />
      <Skeleton aspectRatio={16 / 9} radius="lg" />
    </View>
  );
}

const small = { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small } as const;

const styles = StyleSheet.create({
  header: { gap: spacing[6] },
  text: { gap: spacing[3] },
  tag: { flexDirection: 'row' },
  sentence: { ...small, color: colors.textTertiary },
  badge: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  badgeText: { ...small, flex: 1, color: colors.textSecondary },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
