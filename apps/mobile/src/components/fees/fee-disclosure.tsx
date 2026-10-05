import Decimal from 'decimal.js';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { Locale } from '@ideanest/messages/locale';
import {
  disclosureStateOf,
  type FeeAudience,
  type FeeDisclosure as Disclosure,
} from '@ideanest/plans/fees';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { spacing } from '../../theme';
import { Body, Card, CardTitle, Pill, TONES, useSurface } from '../ui';

/**
 * §22.3's fee disclosure — the web's `FeeDisclosure.tsx`, for a backer at checkout and for a creator
 * on Pricing (#164). Both read one schedule, so the two screens cannot disagree about the same terms.
 *
 * <p>Three answers, kept apart by `disclosureStateOf`: the service said no schedule is set (the only
 * case that may say nothing is deducted), the rates, or a read that failed — which names no figure,
 * says a failure is not "no fee", and links to Pricing, where the rates are published (#145). On
 * Pricing itself that link is the retry.
 *
 * <p>The two fees stay two numbers, never summed, and the sentence that keeps them apart follows the
 * rates. Percentages come from the decimal strings through `decimal.js`.
 */
export function FeeDisclosure({
  disclosure,
  audience,
  onPricing,
  onRetry,
  retrying = false,
  framed = false,
}: {
  /** `null` for a failed read, which has its own sentence — never the unconfigured one. */
  readonly disclosure: Disclosure | null;
  readonly audience: FeeAudience;
  /** The failure sentence's link to Pricing. */
  readonly onPricing: () => void;
  /**
   * Where the page is Pricing itself, a link to Pricing would name the page the reader is on: the
   * failure sentence is then plain text with a "Try again" pill under it.
   */
  readonly onRetry?: () => void;
  readonly retrying?: boolean;
  /** A block of its own on the canvas (Pricing); a section of the sheet it sits in otherwise. */
  readonly framed?: boolean;
}) {
  const t = useT('fees.disclosure');
  const tCommon = useT('common');
  const locale = useLocale();
  const ink = TONES[useSurface() === 'white' ? 'white' : 'dark'];
  const state = disclosureStateOf(disclosure, audience);

  let body: ReactNode;
  let fixed: string | null = null;
  if (state === 'unconfigured') {
    body = t('unconfigured');
  } else if (state === 'unavailable' || disclosure === null) {
    body = t.rich('unavailable', {
      pricing: (chunks) =>
        onRetry === undefined ? (
          <Text accessibilityRole="link" onPress={onPricing} style={[styles.link, { color: ink.primary }]}>
            {chunks}
          </Text>
        ) : (
          chunks
        ),
    });
  } else {
    const platform = percentOf(disclosure.platformRate ?? '', locale);
    const processing = percentOf(disclosure.processingRate ?? '', locale);
    body =
      audience === 'backer'
        ? t('backerBody', { platform, processing })
        : t('creatorBody', { platform, processing, keeps: percentOf(disclosure.creatorReceivesRate ?? '', locale) });
    fixed =
      disclosure.processingFixed !== null &&
      disclosure.currency !== null &&
      !new Decimal(disclosure.processingFixed).isZero()
        ? t('fixedFee', { amount: formatMoney({ amount: disclosure.processingFixed, currency: disclosure.currency }) })
        : null;
  }

  const content = (
    <View style={styles.section} testID="fee-disclosure">
      <CardTitle accessibilityRole="header">
        {audience === 'backer' ? t('backerHeading') : t('creatorHeading')}
      </CardTitle>
      <Body>{body}</Body>
      {fixed === null ? null : <Body>{fixed}</Body>}
      {state === 'unavailable' && onRetry !== undefined ? (
        <View style={styles.start}>
          <Pill label={tCommon('tryAgain')} variant="ghost" size="sm" busy={retrying} onPress={onRetry} />
        </View>
      ) : null}
      {state === 'configured' ? (
        <Body testID="fee-disclosure-two-fees">
          {t('twoFees')}
        </Body>
      ) : null}
    </View>
  );

  return framed ? <Card>{content}</Card> : content;
}

/** A fee fraction ("0.025") as a percentage in the reader's language, from strings only. */
export function percentOf(fraction: string, locale: Locale): string {
  let digits: string;
  try {
    digits = new Decimal(fraction).times(100).toDecimalPlaces(2).toString();
  } catch {
    return fraction;
  }
  const local = locale === 'en' ? digits : digits.replace('.', ',');
  return locale === 'tr' ? `%${local}` : `${local}%`;
}

const styles = StyleSheet.create({
  section: { gap: spacing[2] },
  link: { textDecorationLine: 'underline' },
  start: { alignItems: 'flex-start' },
});
