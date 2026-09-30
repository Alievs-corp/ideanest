import { useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocale } from 'use-intl';
import { pluralCategory, useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight } from '../../theme';
import { announce } from './announce';
import { TONES, useSurface } from './surface';

/**
 * How much of a length limit is left — the native `CharacterCount` (`docs/ui-kit.md` §7.13).
 *
 * <h2>Colour is not the message</h2>
 *
 * Passing the limit changes the WORDS — "3 characters too many" — and only then the colour. A
 * counter that merely turns red has told a colour-blind creator nothing.
 *
 * <h2>The sentence is the catalogue's, in the reader's plural</h2>
 *
 * `common.characterCount.{remaining,tooMany}` hold one sentence per plural category, the web's
 * own copy, and the form is chosen with the app's shared `pluralCategory` (the web's
 * `pluralForm`): Russian picks between three forms by the last digit, Azerbaijani and Turkish
 * repeat one sentence. A sentence assembled from a number and an English noun cannot do that.
 *
 * <h2>Announced when it starts to matter, and once</h2>
 *
 * The count stays on screen and reachable by swiping at all times. It is SPOKEN only inside
 * `announceWithin` of the limit (20, the web's figure), and only after the count has been still
 * for `announceDelayMs` (1000ms, likewise): every keystroke re-arms the timer, so somebody typing
 * quickly past the threshold hears one sentence when they pause instead of a stream that talks
 * over the keyboard echo. It is polite — queued, not interrupting — which is the web's
 * `role="status"`. The same sentence is not announced twice in a row.
 *
 * <p>Counting is the caller's job: characters are not UTF-16 code units (`'🙂'.length` is 2), and
 * the web counts code points, which is how Postgres counts `varchar(n)`.
 */

export interface CharacterCountProps {
  /** Characters used, counted the way the storage counts them. */
  readonly count: number;
  readonly limit: number;
  /** Start announcing once this many characters or fewer remain. */
  readonly announceWithin?: number;
  /** How long the count must be still before it is announced. */
  readonly announceDelayMs?: number;
  readonly testID?: string;
}

export function CharacterCount({
  count,
  limit,
  announceWithin = 20,
  announceDelayMs = 1000,
  testID,
}: CharacterCountProps) {
  const t = useT('common.characterCount');
  const locale = useLocale();
  const surface = useSurface();

  const remaining = limit - count;
  const over = remaining < 0;
  const value = Math.abs(remaining);
  const category = pluralCategory(locale, value);
  const sentence = over
    ? t(`tooMany.${category}`, { count: value })
    : t(`remaining.${category}`, { count: value });

  const said = useRef<string | null>(null);

  useEffect(() => {
    if (remaining > announceWithin) {
      // Forgotten, so coming back inside the threshold later is announced again.
      said.current = null;
      return undefined;
    }
    const timer = setTimeout(() => {
      if (said.current === sentence) return;
      said.current = sentence;
      announce(sentence);
    }, announceDelayMs);
    return () => clearTimeout(timer);
  }, [sentence, remaining, announceWithin, announceDelayMs]);

  return (
    <Text
      testID={testID}
      style={[styles.count, { color: over ? colors.danger : TONES[surface].tertiary }]}
    >
      {sentence}
    </Text>
  );
}

const styles = StyleSheet.create({
  count: {
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    fontVariant: ['tabular-nums'],
  },
});
