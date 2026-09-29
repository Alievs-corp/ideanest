import { Link, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Body, CardTitle, Subheading } from '../components/text';
import { colors, radius, size, spacing } from '../theme';

/**
 * Where an unmatched route lands.
 *
 * It exists because a link this application does not have a screen for is not
 * rare — every campaign link is shared with people whose copy is older than the
 * route it names. `lib/links.ts` refuses a link from a host we do not claim
 * before it gets here; what reaches this screen is one of ours that this build
 * does not know about, and the useful thing to offer is the way back rather than
 * an apology.
 */
export default function NotFoundScreen() {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Subheading>That page is not in the app</Subheading>
      <Body style={{ textAlign: 'center' }}>
        This version of IdeyaNest does not have a screen for that link. It may be on the web.
      </Body>
      <Link href="/" style={styles.button} accessibilityRole="button">
        <CardTitle tone="onLime">Go to Discover</CardTitle>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    padding: size.cardPaddingLarge,
    backgroundColor: colors.surface1,
  },
  button: {
    minHeight: size.touchTarget,
    paddingHorizontal: size.cardPaddingLarge,
    paddingVertical: spacing[3],
    borderRadius: radius.full,
    backgroundColor: colors.lime500,
  },
});
