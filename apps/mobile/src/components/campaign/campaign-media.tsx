import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { CampaignCover } from '../../lib/campaign-page';
import { colors, radius } from '../../theme';
import {
  MediaFrame,
  SharedTarget,
  useSharedSnapshot,
  useSharedTargetDisplay,
  type SharedSnapshot,
} from '../ui';

/**
 * Block 1 — the web's `CampaignMedia`: the cover in a 16:9 box with the large radius.
 *
 * <p><strong>The box is reserved whether or not there is a cover</strong>, so the title below it
 * does not jump when the photograph decodes, and a campaign without one keeps the page's shape
 * instead of opening on its title. Asked for at high priority: it is the largest thing on the
 * first screen.
 *
 * <p>No play affordance and no "has a video" badge: no response carries a video, and the web's
 * page never passes one either (#155, "Story video handling").
 *
 * <p>Decorative to a screen reader — the title right under it names the campaign — and drawn
 * without a fade of its own: the frame rises with the page's first screenful (`FadeUp`, in the
 * screen), and a second fade on the picture inside it would be the same motion twice.
 */
export function CampaignMedia({
  cover,
  tag,
}: {
  readonly cover: CampaignCover | null;
  readonly tag: string;
}) {
  return (
    <SharedTarget tag={tag} waitForDisplay>
      <CoverFrame uri={cover?.url ?? null} />
    </SharedTarget>
  );
}

/** The name the cover goes by on both ends of the card → page flight (`SharedTransition`). */
export function coverTag(creatorSlug: string | undefined, slug: string | undefined): string {
  return `campaign-cover:${creatorSlug ?? ''}/${slug ?? ''}`;
}

/** What the flight to a campaign page draws: the card's cover in the page cover's box. */
export function coverSnapshot(uri: string | null): SharedSnapshot {
  return { uri, radius: radius.lg, background: colors.surface3 };
}

/**
 * The cover a campaign page opens with while it loads, when a flight from a card is landing on it:
 * the card already had the picture, so the page shows it instead of a placeholder block.
 */
export function ArrivingCover({
  tag,
  fallback,
}: {
  readonly tag: string;
  readonly fallback: ReactNode;
}) {
  const snapshot = useSharedSnapshot(tag);
  if (snapshot === null) return fallback;
  return (
    <SharedTarget tag={tag} waitForDisplay>
      <CoverFrame uri={snapshot.uri} />
    </SharedTarget>
  );
}

function CoverFrame({ uri }: { readonly uri: string | null }) {
  const displayed = useSharedTargetDisplay();
  useEffect(() => {
    if (uri === null) displayed?.();
  }, [displayed, uri]);
  return (
    <MediaFrame ratio="16/9" radius="lg" testID="campaign-media">
      {uri === null ? null : (
        <Image
          source={{ uri }}
          contentFit="cover"
          priority="high"
          transition={0}
          style={styles.fill}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="campaign-cover"
          onDisplay={displayed}
        />
      )}
    </MediaFrame>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
