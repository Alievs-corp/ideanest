import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CAMPAIGN_TABS, type CampaignTabId } from '@ideanest/campaign/tabs';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, size, spacing } from '../../theme';
import { useFocusRing } from '../ui';

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
 * <h2>Words and size</h2>
 *
 * The catalogue's `campaign.tabs.*` (#132: the web's English labels are a bug the app does not
 * copy). Each tab is 44pt high; the row scrolls sideways rather than wrapping, because five labels
 * do not fit a 320pt column in four of the languages. The active tab is white over a white 2pt
 * rule, the rest are `textSecondary`; the weight changes too, so colour is not the only signal.
 * No lime — a tab is a place, not an urgency.
 *
 * <p>The row is opaque (`surface1`): it is the list's sticky header, and content scrolls under it.
 */
export interface CampaignTabsProps {
  readonly active: CampaignTabId;
  readonly onSelect: (tab: CampaignTabId) => void;
}

export function CampaignTabs({ active, onSelect }: CampaignTabsProps) {
  const t = useT('campaign.tabs');
  return (
    <View style={styles.bar} testID="campaign-tabs">
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
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={({ pressed }) => [
        styles.tab,
        current ? styles.current : styles.other,
        pressed && !current && styles.pressed,
        ring,
      ]}
      testID={testID}
    >
      <Text
        style={[styles.label, current ? styles.labelCurrent : styles.labelOther]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: { paddingHorizontal: spacing[4], gap: spacing[1] },
  tab: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderBottomWidth: 2,
  },
  current: { borderBottomColor: colors.textPrimary },
  other: { borderBottomColor: 'transparent' },
  pressed: { borderBottomColor: colors.borderStrong },
  label: { fontSize: fontSize.sm },
  labelCurrent: { ...font.medium, color: colors.textPrimary },
  labelOther: { ...font.regular, color: colors.textSecondary },
});
