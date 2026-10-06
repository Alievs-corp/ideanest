import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useT } from '../../lib/i18n';
import { fontSize, lineHeight, spacing } from '../../theme';
import { Avatar, Body, Heading } from '../../components/ui';
import type { PublicProfile } from './wire';

/**
 * Who the profile belongs to — the web's `ProfileHeader` (#156): a 56pt avatar, the name and the
 * handle, with the Follow control beside them (`actions`).
 *
 * <p>The picture is named "{name}'s profile picture" (`profile.avatarAlt`); the initials, drawn
 * when there is none, are named by the name, as the web's `aria-label` does. The name is one line
 * and truncates — except under large Dynamic Type, where it wraps rather than hiding the person's
 * name behind an ellipsis.
 */

/** Past this font scale the name wraps instead of truncating. */
const WRAP_FONT_SCALE = 1.3;

export function ProfileHeader({
  profile,
  actions,
  notice,
}: {
  readonly profile: PublicProfile;
  readonly actions?: ReactNode;
  /** A line under the row — what the Follow control has just said. */
  readonly notice?: ReactNode;
}) {
  const t = useT('profile');
  const { fontScale } = useWindowDimensions();
  const lines = fontScale > WRAP_FONT_SCALE ? undefined : 1;
  const picture = profile.avatarUrl !== null;

  return (
    <View style={styles.column} testID="profile-header">
      <View style={styles.row}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={picture ? t('avatarAlt', { name: profile.name }) : profile.name}
          testID="profile-avatar"
        >
          <Avatar name={profile.name} src={profile.avatarUrl} size="lg" decorative />
        </View>
        <View style={styles.names}>
          <Heading accessibilityRole="header" numberOfLines={lines} testID="profile-name">
            {profile.name}
          </Heading>
          <Body tone="tertiary" numberOfLines={lines} style={styles.handle}>
            {`@${profile.slug}`}
          </Body>
        </View>
        {actions === undefined ? null : <View style={styles.actions}>{actions}</View>}
      </View>
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing[4], rowGap: spacing[3] },
  names: { flex: 1, minWidth: 0, gap: spacing[1] },
  handle: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  actions: { flexShrink: 0 },
});
