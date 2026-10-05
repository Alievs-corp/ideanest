import { render, screen } from '@testing-library/react-native';
import { act } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import az from '@ideanest/messages/az.json';
import { SUPPORTED_LOCALES } from '@ideanest/messages';
import { setLocale } from '../../lib/locale';
import { FeeDisclosure, percentOf } from './fee-disclosure';

/** The fee disclosure's percentages (#164): from decimal strings, in each of the four languages. */

const RATES = {
  configured: true,
  platformRate: '0.05000',
  processingRate: '0.02500',
  processingFixed: null,
  creatorReceivesRate: '0.92500',
  currency: 'AZN',
  effectiveFrom: null,
};

describe('a fee fraction as a percentage', () => {
  it.each([
    ['en', '5%', '2.5%'],
    ['az', '5%', '2,5%'],
    ['ru', '5%', '2,5%'],
    ['tr', '%5', '%2,5'],
  ] as const)('reads "0.05000" and "0.02500" in %s', (locale, five, twoAndAHalf) => {
    expect(percentOf('0.05000', locale)).toBe(five);
    expect(percentOf('0.02500', locale)).toBe(twoAndAHalf);
  });

  it('covers every supported language', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['az', 'en', 'ru', 'tr']);
  });

  it('computes through decimal.js, never through a float', () => {
    // 0.07 * 100 is 7.000000000000001 in IEEE 754.
    expect(percentOf('0.07', 'en')).toBe('7%');
    expect(percentOf('0.029', 'en')).toBe('2.9%');
  });
});

describe('the creator disclosure in Azerbaijani', () => {
  it('prints the rates with a decimal comma', async () => {
    await act(async () => setLocale('az'));
    await render(
      <IntlProvider locale="az" messages={az}>
        <FeeDisclosure disclosure={RATES} audience="creator" onPricing={() => undefined} framed />
      </IntlProvider>,
    );
    expect(screen.getByTestId('fee-disclosure')).toHaveTextContent(/5%/);
    expect(screen.getByTestId('fee-disclosure')).toHaveTextContent(/2,5%/);
    expect(screen.getByTestId('fee-disclosure')).toHaveTextContent(/92,5%/);
    await act(async () => setLocale('en'));
  });

  it('is headed for the creator, not the backer', async () => {
    await render(
      <IntlProvider locale="en" messages={en}>
        <FeeDisclosure disclosure={RATES} audience="creator" onPricing={() => undefined} />
      </IntlProvider>,
    );
    expect(screen.getByRole('header')).toHaveTextContent(en.fees.disclosure.creatorHeading);
  });
});
