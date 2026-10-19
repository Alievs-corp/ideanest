import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAppActive } from '../lib/app-active';

/**
 * The clip a held card plays over its poster (`lib/media/hold-preview.ts`): muted, looping, no
 * controls, and nothing to a screen reader — the card it sits in is the accessible element.
 *
 * <p>Mounted only while the card is held, so a list scrolled past opens no stream, and unmounted
 * on release, which stops the clip and puts the poster back as it was. It pauses while the app is
 * in the background. The view's own background is clear, so the poster under it shows until the
 * first frame arrives instead of a black box.
 *
 * <p>`expo-video` is already in the binary (#331); this ships over the air.
 */
export function HoldPreviewVideo({
  url,
  playing,
  testID = 'hold-preview-video',
}: {
  readonly url: string;
  readonly playing: boolean;
  readonly testID?: string;
}) {
  if (!playing) return null;
  return <PreviewPlayer url={url} testID={testID} />;
}

function PreviewPlayer({ url, testID }: { readonly url: string; readonly testID: string }) {
  const appActive = useAppActive();
  const player = useVideoPlayer(url, (created) => {
    created.loop = true;
    created.muted = true;
  });

  useEffect(() => {
    if (appActive) player.play();
    else player.pause();
  }, [appActive, player]);

  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      allowsPictureInPicture={false}
      // A `SurfaceView` would ignore the card's rounded clip (see `CampaignVideoPlayer`).
      surfaceType="textureView"
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.fill}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'transparent' },
});
