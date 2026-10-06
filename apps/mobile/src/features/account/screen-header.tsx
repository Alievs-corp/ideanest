import { StyleSheet, View } from 'react-native';
import { Body, Heading } from '../../components/ui';
import { spacing } from '../../theme';

/**
 * An account screen's title and the sentence under it — the web's `AccountPageHeader` (#159).
 * Left aligned on the canvas; the title is the screen's header for a screen reader.
 */
export function ScreenHeader({ title, intro }: { readonly title: string; readonly intro?: string }) {
  return (
    <View style={styles.header}>
      <Heading accessibilityRole="header">{title}</Heading>
      {intro === undefined ? null : <Body>{intro}</Body>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing[2] },
});
