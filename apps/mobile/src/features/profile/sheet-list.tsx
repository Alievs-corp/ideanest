import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { ContentSheet, SurfaceProvider, haptics } from '../../components/ui';
import { colors, spacing } from '../../theme';

/**
 * One tab's screen-level list (#156): the dark-canvas header (who, the late-updates card, the
 * tabs), then the white content sheet (`mobile-design` skill §2) carrying the rows and a footer.
 * There is no nested scroller — the header is the list's own header.
 *
 * <p>A virtualised list cannot sit inside a `ContentSheet`, so the sheet is drawn in pieces, as the
 * Pledges tab draws it: its top ends the header, each row and the footer are white bands, and a
 * white backdrop that follows the sheet's top carries it to the bottom edge when the list is short.
 */

/** The screen's side gutter. */
export const GUTTER = spacing[5];

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as typeof FlashList;

export interface SheetListProps<T> {
  readonly data: readonly T[];
  readonly keyExtractor: (item: T) => string;
  readonly renderRow: (item: T, index: number) => ReactElement;
  /** The dark part above the sheet. */
  readonly header: ReactElement;
  /** Inside the sheet, under the rows: states, Show more, the report link. */
  readonly footer: ReactNode;
  readonly onEndReached?: () => void;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly testID?: string;
}

export function SheetList<T>({
  data,
  keyExtractor,
  renderRow,
  header,
  footer,
  onEndReached,
  refreshing,
  onRefresh,
  testID,
}: SheetListProps<T>) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [sheetTop, setSheetTop] = useState(0);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const backdropStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(sheetTop - scrollY.value, 0) }],
  }));

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<T>) => (
      <View style={styles.band}>
        <SurfaceProvider surface="white">{renderRow(item, index)}</SurfaceProvider>
      </View>
    ),
    [renderRow],
  );

  return (
    <View style={styles.page}>
      {sheetTop > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { height: windowHeight }, backdropStyle]}
        />
      ) : null}
      <AnimatedFlashList
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        testID={testID}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.refresh();
              onRefresh();
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        }
        ListHeaderComponent={
          <View onLayout={(event) => setSheetTop(event.nativeEvent.layout.height)}>
            <View style={styles.header}>{header}</View>
            <ContentSheet style={styles.sheetTop} />
          </View>
        }
        ListFooterComponent={
          <View
            style={[
              styles.band,
              styles.footer,
              { paddingBottom: insets.bottom + spacing[8] },
              data.length > 0 && styles.footerAfterRows,
            ]}
          >
            <SurfaceProvider surface="white">{footer}</SurfaceProvider>
          </View>
        }
      />
    </View>
  );
}

function Separator() {
  return <View style={[styles.band, styles.separator]} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface1 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.whiteSurface },
  header: { paddingHorizontal: GUTTER, paddingTop: spacing[4], paddingBottom: spacing[6] },
  // Only the sheet's top: no bleed and no tail.
  sheetTop: { flexGrow: 0, marginHorizontal: 0, marginBottom: 0, paddingBottom: 0 },
  band: { backgroundColor: colors.whiteSurface, paddingHorizontal: GUTTER },
  separator: { height: spacing[4] },
  footer: { gap: spacing[6] },
  footerAfterRows: { paddingTop: spacing[6] },
});
