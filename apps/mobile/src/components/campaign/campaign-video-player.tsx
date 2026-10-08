import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../../theme';
import { FOCUS_DELAY_MS, focusOn } from '../ui/overlay';

/**
 * The campaign video's player (#331) — `expo-video`, mounted only once somebody pressed play.
 *
 * <p>It starts at once because a press asked for it; it is never mounted on arrival, so the page
 * never autoplays and never opens a stream for a reader who only scrolls past. The controls,
 * fullscreen and its rotation are the platform's own (`nativeControls`, `fullscreenOptions`),
 * which bring the system's captions, scrubbing and accessibility for free. Picture in picture is
 * off: the app declares no background playback (`app.config.ts`, the `expo-video` plugin).
 *
 * <ul>
 *   <li>`active` false — another screen pushed over this one, or the app went to the background —
 *       pauses it. Coming back leaves it paused, on the frame it stopped at.</li>
 *   <li>`focusOnMount` moves screen-reader focus onto the player, so the press on "Play" lands the
 *       reader on the controls it just opened rather than on a button that has gone.</li>
 *   <li>Android draws it in a `TextureView`: a `SurfaceView` is a hole punched through the window,
 *       which ignores the frame's rounded clip and shows through the sticky header that scrolls
 *       over it. iOS ignores the prop.</li>
 * </ul>
 *
 * <p>`expo-video` is a native module: a build that predates it does not have it, so this reaches
 * a phone through a new binary, not an over-the-air update — which `runtimeVersion`'s fingerprint
 * already enforces, since the dependency changes it.
 */
export function CampaignVideoPlayer({
  url,
  label,
  active = true,
  focusOnMount = false,
  style,
}: {
  readonly url: string;
  /** The accessible name of the player. */
  readonly label: string;
  /** False pauses it. */
  readonly active?: boolean;
  /** Move screen-reader focus onto it once it is drawn. */
  readonly focusOnMount?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(url, (created) => created.play());
  const view = useRef<VideoView>(null);

  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  useEffect(() => {
    if (!focusOnMount) return undefined;
    // The native view has to exist before VoiceOver or TalkBack can land on it.
    const timer = setTimeout(() => focusOn(view.current?.nativeRef.current), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusOnMount]);

  return (
    <VideoView
      ref={view}
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
      surfaceType="textureView"
      accessibilityLabel={label}
      style={[{ backgroundColor: colors.black }, style]}
      testID="campaign-video-player"
    />
  );
}
