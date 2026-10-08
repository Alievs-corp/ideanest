import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../../theme';

/**
 * The campaign video's player (#331) — `expo-video`, mounted only once somebody pressed play.
 *
 * <p>It starts at once because a press asked for it; it is never mounted on arrival, so the page
 * never autoplays and never opens a stream for a reader who only scrolls past. The controls,
 * fullscreen and its rotation are the platform's own (`nativeControls`, `fullscreenOptions`),
 * which bring the system's captions, scrubbing and accessibility for free. Picture in picture is
 * off: the app declares no background playback (`app.config.ts`, the `expo-video` plugin).
 *
 * <p>`expo-video` is a native module: a build that predates it does not have it, so this reaches
 * a phone through a new binary, not an over-the-air update — which `runtimeVersion`'s fingerprint
 * already enforces, since the dependency changes it.
 */
export function CampaignVideoPlayer({
  url,
  label,
  style,
}: {
  readonly url: string;
  /** The accessible name of the player. */
  readonly label: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(url, (created) => created.play());
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
      accessibilityLabel={label}
      style={[{ backgroundColor: colors.black }, style]}
      testID="campaign-video-player"
    />
  );
}
