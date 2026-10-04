import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../../../icons';
import type { CampaignUpdate } from '@ideanest/campaign/updates';
import { formatDay, useT } from '../../../../lib/i18n';
import { useLocale } from '../../../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing, tracking } from '../../../../theme';
import { Tag } from '../../../ui';
import { EntryCard, entryText } from '../shared/tab-section';
import { upperCaseIn } from './upper-case';

/**
 * One update — the web's `UpdateEntry` (#155): a surface-2 card with the eyebrow "UPDATE 7", the
 * day it was published, a "Backers only" tag where it applies, the title as an H3 and the body
 * with its line breaks kept.
 *
 * <p><strong>The number is the service's</strong> (`update.number`), allocated once at insert and
 * never recomputed — "update 7 said the moulds were late" is a thing a backer says six months on.
 * Nothing here counts the list: numbering by position would renumber every earlier update the
 * first time one was withheld.
 *
 * <p>The day is the device's (`formatDay` in `lib/i18n.tsx`, no zone): the web prints the server's
 * day and swaps it for the viewer's once it hydrates, and a phone is the viewer from the start.
 *
 * <p>The eyebrow is capitalised in code (`./upper-case.ts`), not by `textTransform`, so
 * Azerbaijani and Turkish keep their dotted İ; a screen reader is given the words as written.
 *
 * <p>The list is read anonymously (`publicApi()`), so it is what the public is shown — the service
 * withholds a backers-only update from everybody outside the campaign's team, and the team's view
 * never reaches this page or its offline copy. Nothing is filtered here either: a client-side
 * filter would be a second, weaker copy of the service's rule. The `warning` tag with Lock and a
 * word (never lime, never a colour alone) is drawn whenever the service does send such an update,
 * as the web draws it, because who else can read the paragraph is worth saying beside it.
 */
export function UpdateEntry({ update }: { readonly update: CampaignUpdate }) {
  const t = useT('campaign.updates');
  const locale = useLocale();
  const day = formatDay(update.publishedAt, locale);
  const eyebrow = t('number', { number: String(update.number) });

  return (
    <View style={styles.entry}>
      <EntryCard gap={spacing[3]} testID={`update-${update.number}`}>
        <View style={styles.meta}>
          <Text style={styles.eyebrow} accessibilityLabel={eyebrow}>
            {upperCaseIn(eyebrow, locale)}
          </Text>
          {day === null ? null : <Text style={styles.day}>{day}</Text>}
          {update.visibility === 'BACKERS_ONLY' ? (
            <Tag
              variant="warning"
              icon={Glyphs.Lock}
              label={t('backersOnly')}
              testID={`update-${update.number}-backers-only`}
            />
          ) : null}
        </View>
        <Text accessibilityRole="header" style={entryText.title}>
          {update.title}
        </Text>
        {update.body === '' ? null : <Text style={entryText.body}>{update.body}</Text>}
      </EntryCard>
    </View>
  );
}

const styles = StyleSheet.create({
  // The web's `gap-6`, under the heading and between the cards alike.
  entry: { paddingTop: spacing[6] },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  /** The web's `text-xs font-medium tracking-[0.04em] text-white/40 uppercase` (cased in code). */
  eyebrow: {
    ...font.medium,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    letterSpacing: tracking.eyebrow,
    color: colors.textTertiary,
  },
  day: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
  },
});
