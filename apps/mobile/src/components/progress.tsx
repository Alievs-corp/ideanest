import { StyleSheet, View } from 'react-native';
import { useT } from '../lib/i18n';
import { colors, radius, spacing } from '../theme';
import { Meta } from './text';

/**
 * A campaign's funding progress — `docs/ui-kit.md` §7.11.
 *
 * <h2>Lime means urgent. Success means achieved.</h2>
 *
 * CLAUDE.md §2 states it and this is the component where getting it wrong tells
 * a backer the opposite of the truth: a campaign still asking for money is lime,
 * and one that reached its goal is `--success`. A single token swapped here
 * turns "hurry" into "done" on every card in the feed.
 *
 * <h2>Colour is never the only signal</h2>
 *
 * The percentage is printed beside the bar, and the whole control carries an
 * accessible label saying what it means in words. Somebody who cannot
 * distinguish lime from green — and somebody using a screen reader, who sees no
 * colour at all — reads the same fact.
 */

/**
 * The fill's test identifier.
 *
 * <p>Exported rather than typed twice. A `testID` is also what Maestro drives in the
 * end-to-end suite §19.4 names, so it is a production affordance rather than a hook a
 * test bolted on — and a literal repeated in both places is one that gets renamed in one
 * of them.
 */
export const PROGRESS_FILL = 'progress-fill';

export interface ProgressBarProps {
  /** Percent funded, as the API sends it: a decimal string, never a float. */
  readonly completionPercent: string;
  /** What the bar is measuring, for the accessible label. */
  readonly label: string;
}

/**
 * The bar is clamped to 100 and the label is not.
 *
 * A campaign at 340% has earned the number; a bar drawn at 340% of its track is
 * a layout bug. Parsed with `Number` only after the string has been checked
 * against a strict shape, because the value is arithmetic-free from here on —
 * it becomes a width and nothing else.
 */
function widthPercent(completionPercent: string): number {
  if (!/^\d{1,6}(\.\d+)?$/.test(completionPercent)) return 0;
  return Math.min(Number(completionPercent), 100);
}

/** Rounded for display. The exact figure is a percentage of somebody's money, not a score. */
function readablePercent(completionPercent: string): string {
  if (!/^\d{1,6}(\.\d+)?$/.test(completionPercent)) return '0';
  return String(Math.round(Number(completionPercent)));
}

const styles = StyleSheet.create({
  row: { gap: spacing[2] },
  track: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface3,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full },
});

export function ProgressBar({ completionPercent, label }: ProgressBarProps) {
  const t = useT();
  const percent = widthPercent(completionPercent);
  const reached = percent >= 100;
  const readable = readablePercent(completionPercent);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      // Spoken rather than shown as a colour. The one thing a screen reader
      // cannot infer from a lime bar is what lime means.
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(percent),
        text: t('common.card.progressLabel', { percent: readable }),
      }}
    >
      <View style={styles.track}>
        <View
          testID={PROGRESS_FILL}
          style={[
            styles.fill,
            {
              width: `${percent}%`,
              backgroundColor: reached ? colors.success : colors.lime500,
            },
          ]}
        />
      </View>
      <Meta>
        {reached
          ? t('mobile.funding.reached', { percent: readable })
          : t('common.card.funded', { percent: readable })}
      </Meta>
    </View>
  );
}
