import { StyleSheet, View } from 'react-native';
import { Body, Field, InlineAlert, Pill, Select, TextInput } from '../../../components/ui';
import { useT } from '../../../lib/i18n';
import { spacing } from '../../../theme';
import {
  MAX_SOCIAL_LINKS,
  SOCIAL_PLATFORMS,
  socialPlatformLabel,
  type ProfileSocialLink,
  type SocialPlatform,
} from './api';

/**
 * The accounts somebody keeps elsewhere — the web's `SocialLinksField` (#161). At most five rows
 * and each platform once, enforced by what the controls can reach rather than by validation: a
 * row's picker offers only the platforms no other row has, a new row opens on the first unused
 * one, and "Add a link" is disabled at the cap with a sentence saying why. The addresses are the
 * service's to check.
 */
export function SocialLinksField({
  links,
  disabled,
  error,
  onChange,
}: {
  readonly links: readonly ProfileSocialLink[];
  readonly disabled: boolean;
  readonly error?: string;
  readonly onChange: (links: readonly ProfileSocialLink[]) => void;
}) {
  const t = useT('profile.editor.links');
  const spare = firstUnused(links);
  const atCap = links.length >= MAX_SOCIAL_LINKS;
  const canAdd = !atCap && spare !== undefined;

  function replace(index: number, next: ProfileSocialLink): void {
    onChange(links.map((link, position) => (position === index ? next : link)));
  }

  return (
    <Field grouped label={t('label')} hint={t('hint', { max: MAX_SOCIAL_LINKS })} error={error}>
      <View style={styles.stack}>
        {links.length === 0 ? <Body tone="tertiary">{t('none')}</Body> : null}

        {/* Keyed by position: a platform key would remount the row its own picker just changed. */}
        {links.map((link, index) => {
          const label = socialPlatformLabel(link.platform);
          const available = availableTo(links, index);
          const options = (
            available.includes(link.platform as SocialPlatform)
              ? available
              : [link.platform, ...available]
          ).map((platform) => ({ value: platform, label: socialPlatformLabel(platform) }));

          return (
            <View key={index} style={styles.row} testID={`social-link-${index}`}>
              <Select
                label={t('platformFor', { number: index + 1 })}
                options={options}
                value={link.platform}
                disabled={disabled}
                onChange={(platform) => replace(index, { ...link, platform })}
                testID={`social-link-platform-${index}`}
              />
              <TextInput
                value={link.url}
                onChangeText={(url) => replace(index, { ...link, url })}
                accessibilityLabel={t('addressFor', { platform: label })}
                placeholder={t('addressPlaceholder')}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="URL"
                disabled={disabled}
                testID={`social-link-url-${index}`}
              />
              <View style={styles.remove}>
                <Pill
                  label={t('remove')}
                  accessibilityLabel={t('removeLink', { platform: label })}
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onPress={() => onChange(links.filter((_, position) => position !== index))}
                  testID={`social-link-remove-${index}`}
                />
              </View>
            </View>
          );
        })}

        <View style={styles.footer}>
          <Pill
            label={t('add')}
            variant="ghost"
            disabled={disabled || !canAdd}
            onPress={() => {
              if (spare !== undefined) onChange([...links, { platform: spare, url: '' }]);
            }}
            testID="social-link-add"
          />
          {/* A sentence, always present: the cap is read before it is met, never only a greyed button. */}
          <Body tone="tertiary" testID="social-link-count">
            {atCap
              ? t('atCap', { max: MAX_SOCIAL_LINKS })
              : t('used', { used: links.length, max: MAX_SOCIAL_LINKS })}
          </Body>
        </View>

        {!atCap && spare === undefined ? (
          <InlineAlert
            variant="info"
            title={t('allListedTitle')}
            description={t('allListedBody')}
            testID="social-link-all-listed"
          />
        ) : null}
      </View>
    </Field>
  );
}

/** The platforms a row may offer: everything no other row has taken. */
export function availableTo(links: readonly ProfileSocialLink[], index: number): readonly string[] {
  return SOCIAL_PLATFORMS.filter(
    (platform) => !links.some((link, other) => other !== index && link.platform === platform),
  );
}

/** The platform a new row opens on, or `undefined` when all nine are taken. */
export function firstUnused(links: readonly ProfileSocialLink[]): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((platform) => !links.some((link) => link.platform === platform));
}

const styles = StyleSheet.create({
  stack: { gap: spacing[4] },
  row: { gap: spacing[2] },
  remove: { alignItems: 'flex-start' },
  footer: { gap: spacing[2], alignItems: 'flex-start' },
});
