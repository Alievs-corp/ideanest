import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, readingMeasure, spacing, tracking } from '../../theme';
import { toneColor } from '../text';
import { TONES, useSurface } from '../ui';

/**
 * The Campaign tab's last block — the web's `CampaignRisks` (#155): the creator's own account of
 * what could go wrong, beside the story. The heading is the catalogue's; the text is printed as
 * text, line breaks kept (React Native keeps `\n` in a `Text`, which is the web's `pre-line`).
 * Its tones follow the surface it is drawn on — the page's white content sheet.
 */
export function CampaignRisks({ risks }: { readonly risks: string }) {
  const t = useT('campaign.risks');
  const surface = useSurface();
  return (
    <View style={styles.section} testID="campaign-risks">
      <Text accessibilityRole="header" style={[styles.heading, { color: TONES[surface].primary }]}>
        {t('heading')}
      </Text>
      <Text style={[styles.body, { color: toneColor('reading', surface) }]}>{risks}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing[3] },
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
  },
  body: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.story,
    letterSpacing: tracking.reading,
  },
});
