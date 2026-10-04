import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { checkoutHref } from '../../lib/campaign-actions';
import { useT } from '../../lib/i18n';
import { radius, shadow, spacing } from '../../theme';
import { FadeUp } from '../motion';
import { Pill, SurfaceProvider } from '../ui';

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
  /**
   * The pill's place in the page's first-screenful entry rise (`FadeUp`). The rise is inside the
   * measured view, so the position the screen reads is the pill's resting one.
   */
  readonly entryIndex?: number;
}

export function BackCampaignCta({ projectId, title, onLayout, entryIndex }: BackCampaignCtaProps) {
  const t = useT();
  const router = useRouter();
  const pill = (
    <Pill
      label={t('campaign.back.cta')}
      accessibilityHint={t('mobile.checkout.backHint', { title })}
      variant="primary"
      size="lg"
      fullWidth
      onPress={() => router.push(checkoutHref(projectId))}
    />
  );
  return (
    <View onLayout={onLayout} testID="back-cta">
      {entryIndex === undefined ? pill : <FadeUp index={entryIndex}>{pill}</FadeUp>}
    </View>
  );
}

/** The persistent pill's height (`Pill` size `lg`). */
const BAR_PILL = 48;

/**
 * Where the persistent pill floats: above the home indicator by `spacing[2]`, and never closer to
 * the edge than `spacing[3]` where there is no inset (Android three-button navigation, older
 * iPhones) — the tab bar's own rule (`mobile-design` skill §3.2). A stack route, so the inset is
 * the screen's to read: there is no tab bar under it.
 */
export function persistentBarOffset(insetBottom: number): number {
  return Math.max(insetBottom + spacing[2], spacing[3]);
}

/** How much the end of the list must clear so the floating pill never covers its last line. */
export function persistentBarClearance(insetBottom: number): number {
  return persistentBarOffset(insetBottom) + BAR_PILL + spacing[4];
}

/**
 * The persistent bar: the same pill, floating over the foot of the page while the one in the header
 * has scrolled out of view (#113's sticky call to action). It floats over the white content sheet,
 * so it is the sheet's primary pill — inverted to `surface1` with white words — inset from the
 * edges like the tab bar, with the panel shadow under it.
 *
 * <p><strong>Never two on screen, and never two for a screen reader.</strong> The screen mounts it
 * only while the header's pill is out of view, and it appears and goes without animation — a bar
 * sliding in under a reader's thumb would move the target they are reaching for. It is hidden from
 * accessibility: the header's pill is block 7 in the reading order and stays there, so a
 * screen-reader user meets "Back this campaign" once, where it belongs, rather than again at the end
 * of every swipe through the page.
 */
export function PersistentBackBar({
  projectId,
  title,
}: Omit<BackCampaignCtaProps, 'onLayout' | 'entryIndex'>) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.bar, { bottom: persistentBarOffset(insets.bottom) }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="persistent-back"
    >
      <SurfaceProvider surface="white">
        <Pill
          label={t('campaign.back.cta')}
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => router.push(checkoutHref(projectId))}
          accessibilityHint={t('mobile.checkout.backHint', { title })}
        />
      </SurfaceProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    borderRadius: radius.full,
    boxShadow: shadow.float,
  },
});
