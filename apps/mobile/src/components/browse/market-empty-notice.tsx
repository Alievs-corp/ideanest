import { StyleSheet, View } from 'react-native';
import { Body, Pill } from '../ui';
import { countryName } from '../../features/checkout/format';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { ALL_MARKETS, setMarket, useMarket } from '../../lib/market';
import { spacing } from '../../theme';

/**
 * What an empty list says when it was for one country — issue #533.
 *
 * The phone's region may be a country with no campaigns yet. The list names the country and
 * offers every country, which re-reads every list at once because the market is in their keys.
 * Nothing at all when the reader already browses every country.
 */
export function MarketEmptyNotice() {
  const t = useT('shell.market');
  const locale = useLocale();
  const market = useMarket();

  if (market === ALL_MARKETS) return null;

  return (
    <View style={styles.notice} testID="market-empty">
      <Body tone="primary">{t('emptyTitle', { name: countryName(market, locale) })}</Body>
      <Body tone="secondary">{t('emptyDetail')}</Body>
      <View style={styles.start}>
        <Pill
          label={t('emptyAction')}
          variant="ghost"
          size="sm"
          onPress={() => setMarket(ALL_MARKETS)}
          testID="market-empty-all"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: spacing[2], paddingTop: spacing[4] },
  start: { alignSelf: 'flex-start' },
});
