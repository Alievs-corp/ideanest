import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, radius, size, spacing, tint } from '../../theme';
import { Body, Meta, PressableScale, Subheading, TONES, useFocusRing, useSurface } from '../../components/ui';
import { BLOCK, blockSurface } from '../../components/ui/surface';
import { joinedMonth, socialPlatformLabel } from './format';
import { isHttps, type PublicProfile } from './wire';

/**
 * The About tab — the web's `ProfileAbout` (#156): the biography (or the sentence saying there is
 * none), then the facts that exist, then the accounts elsewhere.
 *
 * <p>The location is text, not a link (`?city=` is refused by discovery, #47). The website and each
 * social address are printed in full, never hidden behind a word, and the address is inside the
 * same pressable as the platform's name, so it is part of what a screen reader announces. Only an
 * `https:` address opens, in the in-app browser — the native `noopener noreferrer`; anything else
 * is drawn as plain text and does nothing.
 */
export function ProfileAbout({ profile }: { readonly profile: PublicProfile }) {
  const t = useT('profile.about');
  const locale = useLocale();
  const surface = useSurface();
  const block = BLOCK[blockSurface(surface)];
  const tone = TONES[surface];
  const rule = surface === 'white' ? tint(colors.black, 0.08) : colors.divider;
  const joined = joinedMonth(profile.joinedAt, locale);
  const bio = profile.bio ?? '';
  const facts = profile.location !== null || profile.websiteUrl !== null || joined !== null;

  return (
    <View style={[styles.card, { backgroundColor: block.rest }]} testID="profile-about">
      <Subheading accessibilityRole="header">{t('heading', { name: profile.name })}</Subheading>
      <Body testID="profile-bio">{bio === '' ? t('empty', { name: profile.name }) : bio}</Body>

      {facts ? (
        <View style={[styles.section, { borderTopColor: rule }]}>
          {profile.location === null ? null : (
            <Fact label={t('basedIn')} testID="profile-fact-location">
              <Body>{profile.location.name}</Body>
            </Fact>
          )}
          {profile.websiteUrl === null ? null : (
            <Fact label={t('website')} testID="profile-fact-website">
              <Address url={profile.websiteUrl} testID="profile-website" />
            </Fact>
          )}
          {joined === null ? null : (
            <Fact label={t('since')} testID="profile-fact-since">
              <Body>{joined}</Body>
            </Fact>
          )}
        </View>
      ) : null}

      {profile.socialLinks.length === 0 ? null : (
        <View style={[styles.section, { borderTopColor: rule }]} testID="profile-elsewhere">
          <Text accessibilityRole="header" style={[styles.elsewhere, { color: tone.secondary }]}>
            {t('elsewhere')}
          </Text>
          {profile.socialLinks.map((link) => (
            <Address
              key={link.platform}
              label={socialPlatformLabel(link.platform)}
              url={link.url}
              testID={`profile-social-${link.platform}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function Fact({
  label,
  children,
  testID,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly testID: string;
}) {
  return (
    <View style={styles.fact} testID={testID}>
      <Meta>{label}</Meta>
      {children}
    </View>
  );
}

/**
 * A user-supplied address, printed in full after the platform's name when there is one: a link
 * that opens it when it is `https:`, plain text otherwise. The visible words are the accessible
 * name — the platform and the address together.
 */
function Address({
  url,
  label,
  testID,
}: {
  readonly url: string;
  readonly label?: string;
  readonly testID: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const tone = TONES[useSurface()];
  const linkable = isHttps(url);
  const words = (
    <Text style={[styles.text, linkable && styles.underline, { color: tone.primary }]}>
      {label === undefined ? url : `${label} `}
      {label === undefined ? null : (
        <Text style={[styles.address, { color: tone.tertiary }]}>{url}</Text>
      )}
    </Text>
  );
  if (!linkable) {
    return (
      <View style={styles.reach} testID={testID}>
        {words}
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole="link"
      onPress={() => void WebBrowser.openBrowserAsync(url)}
      onFocus={onFocus}
      onBlur={onBlur}
      style={styles.linkReach}
      contentStyle={({ pressed }) => [styles.reach, pressed && styles.pressed, ring]}
      testID={testID}
    >
      {words}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[3], padding: spacing[6], borderRadius: radius.xl },
  section: {
    gap: spacing[3],
    marginTop: spacing[3],
    paddingTop: spacing[6],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fact: { gap: spacing[1] },
  elsewhere: { ...font.medium, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  linkReach: { alignSelf: 'stretch' },
  reach: { minHeight: size.touchTarget, justifyContent: 'center', borderRadius: radius.sm },
  pressed: { opacity: 0.64 },
  text: { ...font.regular, fontSize: fontSize.sm, lineHeight: lineHeight.small },
  underline: { textDecorationLine: 'underline' },
  address: { textDecorationLine: 'none' },
});
