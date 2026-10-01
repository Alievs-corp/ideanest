import { StyleSheet, Text, View } from 'react-native';
import { windowFacts, type Collection } from '@ideanest/discovery/collections';
import { formatWindowDate, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing, tint } from '../../theme';

/**
 * A collection's facts row — the web's `<dl>` on `CollectionCard` and `CollectionHeader` (#154):
 * a first fact (the card's campaign count, the header's "In this collection"), then when it
 * closes, then since when it is open. Closing first, because for an open call the deadline is
 * the decision. Dates are long and in UTC (`formatWindowDate`); one that will not parse is
 * dropped, never printed as "Invalid Date".
 *
 * Each fact is one accessible element that reads term and value together — "Closes, 15 October
 * 2026" — rather than two stops a screen reader user has to pair up.
 */
export function CollectionFacts({
  collection,
  first,
  gap = 'card',
  testID,
}: {
  readonly collection: Pick<Collection, 'opensAt' | 'closesAt'>;
  readonly first: { readonly term: string; readonly value: string };
  /** The web's `gap-x-4` on a card and `gap-x-6` on the header. */
  readonly gap?: 'card' | 'header';
  readonly testID?: string;
}) {
  const t = useT('discovery.collections');
  const locale = useLocale();
  const facts = [
    { key: 'first', term: first.term, date: first.value },
    ...windowFacts(
      collection,
      { closes: t('window.closes'), openSince: t('window.openSince') },
      (iso) => formatWindowDate(iso, locale),
    ).map((fact) => ({ key: fact.term, term: fact.term, date: fact.date })),
  ];

  return (
    <View style={[styles.row, gap === 'header' && styles.wide]} testID={testID}>
      {facts.map((fact) => (
        <View
          key={fact.key}
          style={styles.fact}
          accessible
          accessibilityLabel={`${fact.term}, ${fact.date}`}
          testID="collection-fact"
        >
          <Text style={styles.term}>{fact.term}</Text>
          <Text style={styles.value}>{fact.date}</Text>
        </View>
      ))}
    </View>
  );
}

const text = { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small } as const;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing[4],
    rowGap: spacing[1],
  },
  wide: { columnGap: spacing[6], rowGap: spacing[2] },
  fact: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[1] + spacing[1] / 2 },
  term: { ...text, color: colors.textTertiary },
  // The web's `text-white/80`.
  value: { ...text, color: tint(colors.textPrimary, 0.8), fontVariant: ['tabular-nums'] },
});
