import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CAMPAIGN_TABS, type CampaignTabId } from '@ideanest/campaign/tabs';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, radius, size, spacing } from '../../theme';
import { useFocusRing } from '../ui';
import { AnimatedPressable, usePressScale } from '../ui/press-scale';
import { BLOCK, TONES, blockSurface, useSurface } from '../ui/surface';

/**
 * Block 11 — the web's `CampaignTabs` (#155): Campaign · Creator · FAQ · Updates · Comments.
 *
 * <h2>A real tab list here, unlike the web</h2>
 *
 * The web's tabs are links in a `<nav>`, because following one navigates and an ARIA tab widget
 * would promise arrow-key behaviour the page does not have. Natively the tab is local state over
 * one list (the `?tab=` param mirrors it), so the content changes in place and `tablist` / `tab`
 * with `selected` is the honest description — VoiceOver and TalkBack both read "tab, 2 of 5".
 *
 * <h2>Pills, in the sheet's language</h2>
 *
 * Each tab is a 44pt pill that gives under the thumb (`usePressScale`, `mobile-design` skill §6.3).
 * The row scrolls sideways rather than wrapping, because five labels do not fit a 320pt column in
 * four of the languages — which is why this is not a `SegmentedPill`, whose equal segments would
 * truncate them. The chosen tab is the surface's primary pill (white on the canvas, `surface1` on
 * the white sheet the page draws it in) and its label is heavier, so colour is not the only signal.
 * No lime — a tab is a place, not an urgency.
 *
 * <p>The row is opaque: it is the list's sticky header, and content scrolls under it.
 */
export interface CampaignTabsProps {
  readonly active: CampaignTabId;
  readonly onSelect: (tab: CampaignTabId) => void;
}

export function CampaignTabs({ active, onSelect }: CampaignTabsProps) {
  const t = useT('campaign.tabs');
  const onWhite = useSurface() === 'white';
  return (
    <View
      style={[styles.bar, { backgroundColor: onWhite ? colors.whiteSurface : colors.surface1 }]}
      testID="campaign-tabs"
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={t('label')}
        contentContainerStyle={styles.row}
      >
        {CAMPAIGN_TABS.map((tab) => (
          <TabButton
            key={tab.id}
            label={t(tab.id)}
            current={tab.id === active}
            onPress={() => onSelect(tab.id)}
            testID={`campaign-tab-${tab.id}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function TabButton({
  label,
  current,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly current: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const block = blockSurface(useSurface());
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  // The chosen pill is the surface's primary one: white on the canvas, inverted on white.
  const chosen =
    block === 'white'
      ? { fill: colors.surface1, ink: colors.textPrimary }
      : { fill: colors.whiteSurface, ink: colors.textOnWhite };
  const fill = current ? chosen.fill : press.pressed ? BLOCK[block].pressed : BLOCK[block].rest;
  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={onFocus}
      onBlur={onBlur}
      style={[styles.tab, { backgroundColor: fill }, ring, press.style]}
      testID={testID}
    >
      <Text
        style={[
          styles.label,
          current ? styles.labelCurrent : styles.labelOther,
          { color: current ? chosen.ink : TONES[block].secondary },
        ]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingVertical: spacing[3] },
  row: { paddingHorizontal: spacing[5], gap: spacing[2] },
  tab: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
  },
  label: { fontSize: fontSize.sm },
  labelCurrent: { ...font.medium },
  labelOther: { ...font.regular },
});
