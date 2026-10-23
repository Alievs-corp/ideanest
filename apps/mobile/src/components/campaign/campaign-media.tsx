import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Glyphs } from '../../icons';
import type { CampaignCover, CampaignPageVideo } from '../../lib/campaign-page';
import { useT } from '../../lib/i18n';
import { clockDuration, wholeSeconds } from '../../lib/media/duration';
import { colors, radius, size, spacing, tint } from '../../theme';
import { Meta } from '../text';
import {
  Icon,
  MediaFrame,
  PressableScale,
  SharedTarget,
  useSharedSnapshot,
  useReducedMotion,
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
 * A campaign with a video is covered by it: the picture is the video's own poster — what the
 * card shows too (`cardCoverFrom`), so the card's cover flies to the same still — with a play
 * button over it and the clip's length in the corner. Without a video it is the uploaded cover. The whole box
 * is the button, named "Play the campaign video, 45 seconds long". Nothing plays until it is
 * pressed — never on arrival, and never on a phone that asked for less motion — and the player is
 * not even mounted before then (`CampaignVideoPlayer`), so a page that is only scrolled past opens
 * no stream. Pressed, the native player takes the box with its own controls and fullscreen, and
 * screen-reader focus moves onto it.
 *
 * <p>`active` is the screen's own (`focused && appActive`): a push to checkout or sign-in leaves
 * this screen mounted underneath, and a video still playing there would be heard over the next
 * screen. It pauses the moment the page stops being the one in front; it does not resume on its
 * own when the reader comes back.
 *
 * <h2>The cover as a second page (#545)</h2>
 *
 * Covered by its video's still, a campaign's uploaded cover was nowhere on its page. With both, the
 * box pages sideways: the video first, as above, then the cover. Paging is the platform's own
 * scroll (`pagingEnabled`), so a swipe follows the finger with nothing animated on top of it; the
 * dots under the box jump straight to a page, without the scroll under Reduce Motion. The page out
 * of sight is hidden from a screen reader, and leaving the video's page pauses it. A campaign with
 * only one of the two has no dots and renders as before.
 */
export function CampaignMedia({
  cover,
  video = null,
  active = true,
  tag,
}: {
  readonly cover: CampaignCover | null;
  readonly video?: CampaignPageVideo | null;
  /** Whether the page is the one in front, with the app in the foreground. */
  readonly active?: boolean;
  readonly tag: string;
}) {
  if (video !== null && cover !== null) {
    return <VideoAndCover cover={cover} video={video} active={active} tag={tag} />;
  }
  return (
    <SharedTarget tag={tag} waitForDisplay>
      <CoverFrame uri={video?.posterUrl ?? cover?.url ?? null}>
        {video === null ? null : <VideoLayer video={video} active={active} />}
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
      {uri === null ? null : <CoverImage uri={uri} onDisplay={displayed} />}
      {children}
    </MediaFrame>
  );
}

function CoverImage({
  uri,
  onDisplay,
  priority = 'high',
  testID = 'campaign-cover',
}: {
  readonly uri: string;
  readonly onDisplay?: () => void;
  readonly priority?: 'high' | 'normal';
  readonly testID?: string;
}) {
  return (
    <Image
      source={{ uri }}
      contentFit="cover"
      priority={priority}
      transition={0}
      style={styles.fill}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      onDisplay={onDisplay}
    />
  );
}

/** The poster, telling the card's flight that the picture it lands on is drawn. */
function Poster({ uri }: { readonly uri: string }) {
  return <CoverImage uri={uri} onDisplay={useSharedTargetDisplay()} />;
}

/** Two pages in the one box — the video, then the cover — and the dots that choose between them. */
function VideoAndCover({
  cover,
  video,
  active,
  tag,
}: {
  readonly cover: CampaignCover;
  readonly video: CampaignPageVideo;
  readonly active: boolean;
  readonly tag: string;
}) {
  const t = useT('mobile.campaign.video');
  const reduced = useReducedMotion();
  const pager = useRef<ScrollView>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(0);

  function show(to: number): void {
    pager.current?.scrollTo({ x: to * box.width, animated: !reduced });
    setPage(to);
  }

  return (
    <View style={styles.slides}>
      {/* The flight lands on the box alone; the dots are not part of the picture it carries. */}
      <SharedTarget tag={tag} waitForDisplay>
        <MediaFrame ratio="16/9" radius="lg" testID="campaign-media">
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.fill}
            onLayout={({ nativeEvent }) =>
              setBox({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
            }
            onMomentumScrollEnd={({ nativeEvent }) => {
              if (box.width > 0) setPage(nativeEvent.contentOffset.x < box.width / 2 ? 0 : 1);
            }}
            testID="campaign-media-pager"
          >
            <View
              style={box}
              accessibilityElementsHidden={page !== 0}
              importantForAccessibility={page === 0 ? 'auto' : 'no-hide-descendants'}
              testID="campaign-media-page-video"
            >
              <Poster uri={video.posterUrl} />
              <VideoLayer video={video} active={active && page === 0} />
            </View>
            <View
              style={box}
              accessibilityElementsHidden={page !== 1}
              importantForAccessibility={page === 1 ? 'auto' : 'no-hide-descendants'}
              testID="campaign-media-page-cover"
            >
              <CoverImage uri={cover.url} priority="normal" testID="campaign-cover-image" />
            </View>
          </ScrollView>
        </MediaFrame>
      </SharedTarget>

      <View style={styles.dots}>
        {[t('showVideo'), t('showCover')].map((name, index) => (
          <PressableScale
            key={name}
            contentStyle={styles.dotPress}
            hitSlop={DOT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={name}
            accessibilityState={{ selected: index === page }}
            onPress={() => show(index)}
            testID={`campaign-media-dot-${index}`}
          >
            <View style={[styles.dot, index === page ? styles.dotOn : null]} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

/** A dot is drawn small and pressed at the platform's minimum. */
const DOT_SLOP = (size.touchTarget - spacing[6]) / 2;

/** The play button over the picture, and the player once it has been pressed. */
function VideoLayer({ video, active }: { readonly video: CampaignPageVideo; readonly active: boolean }) {
  const t = useT('mobile.campaign.video');
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <CampaignVideoPlayer url={video.url} label={t('player')} active={active} focusOnMount style={styles.fill} />
    );
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
        <Icon icon={Glyphs.Play} variant="bulk" size={20} color={colors.textOnWhite} />
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
  slides: { gap: spacing[2] },
  dots: { flexDirection: 'row', justifyContent: 'center' },
  dotPress: { width: size.touchTarget, height: spacing[6], alignItems: 'center', justifyContent: 'center' },
  // Size and fill both change, so the page shown is not told by colour alone.
  dot: {
    width: spacing[2],
    height: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.textPrimary,
    opacity: 0.32,
    transform: [{ scale: 0.75 }],
  },
  dotOn: { opacity: 1, transform: [{ scale: 1 }] },
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
