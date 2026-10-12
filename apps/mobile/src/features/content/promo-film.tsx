import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { promoFilm } from '@ideanest/messages/promo-film';
import { CampaignVideoPlayer } from '../../components/campaign/campaign-video-player';
import { Meta } from '../../components/text';
import { Icon, MediaFrame, PressableScale } from '../../components/ui';
import { Glyphs } from '../../icons';
import { useAppActive } from '../../lib/app-active';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, radius, spacing } from '../../theme';

/**
 * The promo film on How it works — issue #405, the web's `PromoFilm`.
 *
 * <p>The poster is the film's end card, and nothing streams until "Play" is pressed: the same
 * shape as a campaign video (`CampaignMedia`), with the same player, so it pauses when another
 * screen covers this one or the app goes to the background. Phones get the 720p cut, a third of
 * the size of the web's. `expo-video` is already in the binary, so this ships over the air.
 */
export function PromoFilm() {
  const t = useT('static.howItWorks.film');
  const film = promoFilm(useLocale());
  const focused = useIsFocused();
  const appActive = useAppActive();
  const active = focused && appActive;
  const [playing, setPlaying] = useState(false);

  return (
    <View style={styles.wrap} testID="promo-film">
      <MediaFrame ratio={{ width: film.width, height: film.height }} radius="lg">
        {playing ? (
          <CampaignVideoPlayer url={film.mobileUrl} label={t('label')} active={active} focusOnMount style={styles.fill} />
        ) : (
          <>
            <Image
              source={{ uri: film.posterUrl }}
              contentFit="cover"
              transition={0}
              style={styles.fill}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="promo-film-poster"
            />
            <PressableScale
              style={styles.fill}
              contentStyle={styles.press}
              accessibilityRole="button"
              accessibilityLabel={t('playName')}
              onPress={() => setPlaying(true)}
              testID="promo-film-play"
            >
              <View style={styles.button}>
                <Icon icon={Glyphs.Play} variant="bulk" size={20} color={colors.textOnWhite} />
              </View>
            </PressableScale>
          </>
        )}
      </MediaFrame>
      <View style={styles.caption}>
        <Meta>
          {t('title')} · {t('duration')}
        </Meta>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '78%', alignSelf: 'center' },
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
  caption: { marginTop: spacing[3], alignItems: 'center' },
});
