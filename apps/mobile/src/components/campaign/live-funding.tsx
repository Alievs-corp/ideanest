import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Decimal from 'decimal.js';
import { Users } from 'lucide-react-native';
import { formatMoney, type Money } from '@ideanest/money';
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
  }
  const from = since.current.from;

  const total = useMemo(
    () => updates.slice(from).reduce((running, update) => addToTotal(running, update.amount), pledged),
    [updates, from, pledged],
  );

  const completion = completionOf(total, goal);
  const funded = completion !== null && completion.greaterThanOrEqualTo(new Decimal(100));
  const percent = completion === null ? '0' : completion.toFixed(0);

  return (
    <View style={styles.column} testID="live-funding">
      <ProgressBar
        completionPercent={completion === null ? '0' : completion.toFixed(2)}
        size="md"
        showLabel={false}
        label={t('progressLabel', { percent })}
      />
      <View style={styles.figures}>
        <StatBlock
          size="md"
          value={formatMoney(total)}
          label={t('pledged')}
          testID="funding-pledged"
        />
        {completion === null ? null : (
          <StatBlock
            size="md"
            value={`${percent}%`}
            label={funded ? t('funded') : t('ofGoal')}
            tone={funded ? 'success' : 'default'}
            testID="funding-percent"
          />
        )}
        <StatBlock
          size="md"
          icon={Users}
          value={formatCount(backersCount, locale)}
          label={t(`backers.${pluralCategory(locale, backersCount)}`)}
          testID="funding-backers"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[3] },
  // The web's `gap-x-6 gap-y-2`: a row that wraps, 24 between figures.
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[6], rowGap: spacing[2] },
});
