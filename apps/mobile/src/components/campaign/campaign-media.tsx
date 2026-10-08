import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Glyphs } from '../../icons';
import type { CampaignCover, CampaignPageVideo } from '../../lib/campaign-page';
import { useT } from '../../lib/i18n';
import { clockDuration, wholeSeconds } from '../../lib/media/duration';
import { colors, radius, spacing, tint } from '../../theme';
import { Meta } from '../text';
import {
  Icon,
  MediaFrame,
  PressableScale,
  SharedTarget,
  useSharedSnapshot,
  useSharedTargetDisplay,
  type SharedSnapshot,
} from '../ui';
import { CampaignVideoPlayer } from './campaign-video-player';

/**
 * Block 1 — the web's `CampaignMedia`: the cover in a 16:9 box with the large radius, and the
 * campaign's video in the same box when it has one (#331).
 *
 * <p><strong>The box is reserved whether or not there is a cover</strong>, so the title below it
 * does not jump when the photograph decodes, and a campaign without one keeps the page's shape
 * instead of opening on its title. Asked for at high priority: it is the largest thing on the
 * first screen.
 *
 * <p>Decorative to a screen reader when there is no video — the title right under it names the
 * campaign — and drawn without a fade of its own: the frame rises with the page's first screenful
 * (`FadeUp`, in the screen), and a second fade on the picture inside it would be the same motion
 * twice.
 *
 * <h2>The video</h2>
 *
 * The cover stays the picture (it is what the card's cover flies to), or the video's poster when
 * there is no cover, with a play button over it and the clip's length in the corner. The whole box
 * is the button, named "Play the campaign video, 45 seconds long". Nothing plays until it is
 * pressed — never on arrival, and never on a phone that asked for less motion — and the player is
 * not even mounted before then (`CampaignVideoPlayer`), so a page that is only scrolled past opens
 * no stream. Pressed, the native player takes the box with its own controls and fullscreen.
 */
export function CampaignMedia({
  cover,
  video = null,
  tag,
}: {
  readonly cover: CampaignCover | null;
  readonly video?: CampaignPageVideo | null;
  readonly tag: string;
}) {
  return (
    <SharedTarget tag={tag} waitForDisplay>
      <CoverFrame uri={cover?.url ?? video?.posterUrl ?? null}>
        {video === null ? null : <VideoLayer video={video} />}
      </CoverFrame>
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

function CoverFrame({ uri, children }: { readonly uri: string | null; readonly children?: ReactNode }) {
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
      {children}
    </MediaFrame>
  );
}

/** The play button over the picture, and the player once it has been pressed. */
function VideoLayer({ video }: { readonly video: CampaignPageVideo }) {
  const t = useT('mobile.campaign.video');
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return <CampaignVideoPlayer url={video.url} label={t('player')} style={styles.fill} />;
  }
  return (
    <PressableScale
      style={styles.fill}
      contentStyle={styles.press}
      accessibilityRole="button"
      accessibilityLabel={t('play', { seconds: wholeSeconds(video.durationMs) })}
      onPress={() => setPlaying(true)}
      testID="campaign-video-play"
    >
      <View style={styles.button}>
        <Icon icon={Glyphs.Play} variant="bold" size={24} color={colors.textOnWhite} />
      </View>
      <View style={styles.length}>
        <Meta tone="primary" testID="campaign-video-length">
          {clockDuration(video.durationMs)}
        </Meta>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  press: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: {
    width: spacing[16],
    height: spacing[16],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteSurface,
  },
  length: {
    position: 'absolute',
    right: spacing[3],
    bottom: spacing[3],
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    backgroundColor: tint(colors.black, 0.64),
  },
});
