import { StyleSheet, Text, View } from 'react-native';
import type { CampaignFaq } from '@ideanest/campaign/faqs';
import { useT } from '../../../../lib/i18n';
import { spacing } from '../../../../theme';
import { EntryCard, entryText } from '../shared/tab-section';

/**
 * One question and its answer — the web's `FaqEntry` (#155): a surface-2 card, the question as an
 * H3 and the answer below it with its line breaks kept. **Always open.** There is no accordion,
 * for the web's reasons (`CampaignFaqs.tsx`): collapsed text is text a reader cannot find, an
 * answer is long content that §8 keeps still, and the list is bounded at fifty.
 *
 * <h2>The number is spoken, not drawn</h2>
 *
 * The web's list is an `<ol>`, so a screen reader says "item 3 of 6" and nothing is printed. A
 * React Native list has no such semantics — and on this page each card is its own row of the
 * page's one list — so the position goes into the question's accessible name instead ("Question
 * 3 of 6: …"), and the screen looks the same as the web's.
 */
export function FaqEntry({
  faq,
  index,
  count,
}: {
  readonly faq: CampaignFaq;
  /** The entry's place in the creator's order, from 1. */
  readonly index: number;
  readonly count: number;
}) {
  const t = useT('mobile.campaign.faq');
  return (
    <View style={index === 1 ? styles.first : styles.next}>
      <EntryCard gap={spacing[2]} testID={`faq-${faq.id}`}>
        <Text
          accessibilityRole="header"
          accessibilityLabel={t('questionLabel', {
            index: String(index),
            count: String(count),
            question: faq.question,
          })}
          style={entryText.title}
        >
          {faq.question}
        </Text>
        <Text style={entryText.body}>{faq.answer}</Text>
      </EntryCard>
    </View>
  );
}

const styles = StyleSheet.create({
  // The web's `gap-6` under the heading, then `gap-4` between the cards.
  first: { paddingTop: spacing[6] },
  next: { paddingTop: spacing[4] },
});
