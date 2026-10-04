import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Decimal from 'decimal.js';
import { Glyphs } from '../../icons';
import type { Money } from '@ideanest/money';
import { completionOf } from '@ideanest/campaign/completion';
import { addToTotal } from '@ideanest/campaign/realtime';
import { formatCount, pluralCategory, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { useCampaignUpdates } from '../../lib/use-campaign-updates';
import { spacing } from '../../theme';
import { ProgressBar, StatBlock } from '../ui';

/**
 * Block 5's figures — the web's `LiveFunding` (#155): the bar, what has been pledged, the funded
 * percent and the backers.
 *
 * <h2>Money</h2>
 *
 * Every amount is the service's decimal string, formatted by `@ideanest/money`. The percent is
 * `completionOf` — `decimal.js`, rounded down — over the live total, and each live frame is added
 * with `addToTotal` at the starting total's scale; a frame in another currency is ignored. No
 * figure on this page goes through a JavaScript number.
 *
 * <h2>Live, and what a refresh does to it</h2>
 *
 * The frames received since the screen opened are added to the figure the page read. A pull to
 * refresh reads a new figure that already contains them, so the running sum starts again from
 * there: the frames are counted from the moment the base changed, and a pledge is never added
 * twice. The backer count is not live, as on the web — a frame says how much, not who.
 */
export interface LiveFundingProps {
  readonly goal: Money;
  readonly pledged: Money;
  readonly backersCount: number;
  /** The socket's address, or `null` for none (`realtimeUrl`'s answer, or offline). */
  readonly socketUrl: string | null;
  /** The screen is focused and the app in the foreground (`lib/app-active.ts`). */
  readonly active: boolean;
}

export function LiveFunding({ goal, pledged, backersCount, socketUrl, active }: LiveFundingProps) {
  const t = useT('campaign.funding');
  const locale = useLocale();
  const { updates } = useCampaignUpdates(socketUrl, active);

  /*
   * Where the frames that belong to the current base start. Moved in render rather than in an
   * effect, so the frame that shows a refreshed base never adds the old frames to it as well.
   */
  const since = useRef({ base: pledged.amount, from: 0 });
  if (since.current.base !== pledged.amount) {
    since.current = { base: pledged.amount, from: updates.length };
  } else if (updates.length < since.current.from) {
    // The hook dropped its frames (another channel): count from the start of the new ones.
    since.current = { base: pledged.amount, from: 0 };
  }
  const from = since.current.from;

  const total = useMemo(
    () => updates.slice(from).reduce((running, update) => addToTotal(running, update.amount), pledged),
    [updates, from, pledged],
  );

  const completion = completionOf(total, goal);
  const funded = completion !== null && completion.greaterThanOrEqualTo(new Decimal(100));
  /*
   * Down, never to the nearest: 99.5% is not "100%", and a figure that read 100 beside a bar that
   * has not turned would say the goal was met when it was not.
   */
  const percent = completion === null ? '0' : completion.toFixed(0, Decimal.ROUND_DOWN);

  return (
    <View style={styles.column} testID="live-funding">
      {/*
        The screen's hero figure (`mobile-design` skill §2): the wire's strings, formatted by
        `@ideanest/money` inside `HeroFigure`, counting up on first view and rolling on each live
        frame after it.
      */}
      <StatBlock
        size="lg"
        money={total}
        motion="count"
        label={t('pledged')}
        testID="funding-pledged"
      />
      {/*
        The whole percent, already rounded down: the kit reads its accessible value to the nearest
        whole number, which would say "100 percent" of a bar at 99.5.
      */}
      <ProgressBar
        completionPercent={percent}
        size="md"
        showLabel={false}
        label={t('progressLabel', { percent })}
      />
      <View style={styles.figures}>
        {completion === null ? null : (
          <StatBlock
            size="md"
            value={`${percent}%`}
            motion="count"
            label={funded ? t('funded') : t('ofGoal')}
            tone={funded ? 'success' : 'default'}
            testID="funding-percent"
          />
        )}
        <StatBlock
          size="md"
          icon={Glyphs.People}
          value={formatCount(backersCount, locale)}
          motion="count"
          label={t(`backers.${pluralCategory(locale, backersCount)}`)}
          testID="funding-backers"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[4] },
  // The web's `gap-x-6 gap-y-2`: a row that wraps, 24 between figures.
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[6], rowGap: spacing[2] },
});
