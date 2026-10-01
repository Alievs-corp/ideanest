import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { checkoutHref } from '../../lib/campaign-actions';
import { useT } from '../../lib/i18n';
import { colors, spacing } from '../../theme';
import { Pill } from '../ui';

/**
 * Block 7 — the web's `BackCampaignCta` (#155), and its persistent twin at the foot of the screen.
 *
 * <h2>White, not lime</h2>
 *
 * A white pill, 48pt, full width, with dark text — the web's own. Lime on this page belongs to the
 * two-days-left chip and to nothing else; a lime "Back" would be a second "act now" on a page that
 * is already telling a reader it is closing.
 *
 * <h2>Shown only where pledges are taken</h2>
 *
 * The caller renders it only when `acceptsPledges` is true — LIVE before its deadline,
 * CLOSING_WINDOW and EXTENDED — so a closed, a pre-launch and a late-pledge campaign have no Back
 * control at all, in the header or at the foot.
 *
 * <h2>Where it goes</h2>
 *
 * `checkoutHref` (`lib/campaign-actions.ts`): the app's `campaigns/[id]/back`, which hands over to
 * the web checkout until #157 and is the checkout after it — never the campaign page. Its hint says
 * it goes on to the web, which stays true until #157.
 */
export interface BackCampaignCtaProps {
  readonly projectId: string;
  readonly title: string;
  /** Where the pill sits in the list header — the screen hides the persistent bar while it shows. */
  readonly onLayout?: (event: LayoutChangeEvent) => void;
}

export function BackCampaignCta({ projectId, title, onLayout }: BackCampaignCtaProps) {
  const t = useT();
  const router = useRouter();
  return (
    <View onLayout={onLayout} testID="back-cta">
      <Pill
        label={t('campaign.back.cta')}
        accessibilityHint={t('mobile.campaign.backOnWeb', { title })}
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => router.push(checkoutHref(projectId))}
      />
    </View>
  );
}

/**
 * The persistent bar: the same white pill, pinned under the list while the one in the header has
 * scrolled out of view (#113's sticky call to action, which docs/motion-system.md §5 budgets for
 * the project page).
 *
 * <p><strong>Never two on screen, and never two for a screen reader.</strong> The screen mounts it
 * only while the header's pill is out of view, and it appears and goes without animation — a bar
 * sliding in under a reader's thumb would be motion in the one place money is closest. It is
 * hidden from accessibility: the header's pill is block 7 in the reading order and stays there,
 * so a screen-reader user meets "Back this campaign" once, where it belongs, rather than again
 * at the end of every swipe through the page.
 */
export function PersistentBackBar({ projectId, title }: Omit<BackCampaignCtaProps, 'onLayout'>) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bar, { paddingBottom: spacing[3] + insets.bottom }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="persistent-back"
    >
      <Pill
        label={t('campaign.back.cta')}
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => router.push(checkoutHref(projectId))}
        accessibilityHint={t('mobile.campaign.backOnWeb', { title })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface2,
  },
});
