import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { Locale } from '@ideanest/messages';
import type { Card } from '../api/queries';
import { compactCount } from '../features/audience/compact-count';
import { sendAudienceEvent } from '../features/audience/send';
import { AppIntlProvider } from '../lib/i18n';
import { setLocale } from '../lib/locale';
import { colors, darkColors, tint } from '../theme';
import { ProjectCard } from './project-card';

/**
 * The card's eye chip and its CLICK (#636): the all-time view count at the bottom-left of the
 * cover, compact, light on a dark scrim, absent at zero, read in the card's one accessible value;
 * and a press that counts where it was pressed.
 */

const sent = sendAudienceEvent as jest.Mock;

const LIVE: Card = {
  id: 'c-1',
  slug: 'solar-lamp',
  creatorSlug: 'aysel',
  creator: { name: 'Aysel', slug: 'aysel' },
  title: 'Solar Lamp',
  state: 'LIVE',
  badge: 'live',
  completionPercent: '42.50',
  pledged: { amount: '1062.50', currency: 'AZN' },
  goal: { amount: '2500.00', currency: 'AZN' },
  backersCount: 12,
  daysLeft: 9,
} as Card;

async function renderCard(card: Card, locale: Locale = 'en', surface?: 'HOME' | 'SEARCH') {
  await act(async () => setLocale(locale));
  return render(
    <AppIntlProvider>
      <ProjectCard card={card} {...(surface === undefined ? {} : { surface })} />
    </AppIntlProvider>,
  );
}

const chip = () => screen.queryByTestId('view-count-chip', { includeHiddenElements: true });

beforeEach(() => sent.mockClear());

afterAll(async () => {
  await act(async () => setLocale('en'));
});

describe('the eye chip', () => {
  it.each([0, undefined])('is not drawn for %s views, and the value does not mention views', async (viewCount) => {
    await renderCard({ ...LIVE, viewCount });
    expect(chip()).toBeNull();
    expect(screen.getByRole('link')).toHaveAccessibilityValue({
      text: 'Live, 42% funded, 12 backers, 9 days left',
    });
  });

  it.each([
    ['en', 7, '7'],
    ['en', 980, '980'],
    ['en', 15_300, '15.3k'],
    ['ru', 15_300, '15,3 тыс.'],
    ['az', 1_250_000, '1,3 mln'],
    ['tr', 2_000, '2 B'],
  ] as const)('in %s, %i views reads "%s"', async (locale, viewCount, words) => {
    await renderCard({ ...LIVE, viewCount }, locale);
    expect(screen.getByText(words, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('icon-Eye', { includeHiddenElements: true })).toBeTruthy();
  });

  it('is read once, in the card’s value, with the catalogue’s plural', async () => {
    await renderCard({ ...LIVE, viewCount: 15_300 });
    expect(screen.getByRole('link')).toHaveAccessibilityValue({
      text: 'Live, 42% funded, 12 backers, 15300 views, 9 days left',
    });
    await renderCard({ ...LIVE, viewCount: 1 });
    expect(screen.getByRole('link')).toHaveAccessibilityValue({
      text: 'Live, 42% funded, 12 backers, 1 view, 9 days left',
    });
    // Not a second stop on the picture.
    expect(chip()?.props.accessibilityElementsHidden).toBe(true);
    expect(chip()?.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('is light words on the black scrim at the cover’s bottom-left, and takes no touch', async () => {
    await renderCard({ ...LIVE, viewCount: 42 });
    const style = StyleSheet.flatten(chip()?.props.style);
    expect(style).toMatchObject({ position: 'absolute', left: expect.any(Number), bottom: expect.any(Number) });
    expect(style.backgroundColor).toBe(tint(colors.black, 0.64));
    expect(chip()?.props.pointerEvents).toBe('none');
    const words = screen.getByText('42', { includeHiddenElements: true });
    expect(StyleSheet.flatten(words.props.style).color).toBe(darkColors.textPrimary);
    expect(StyleSheet.flatten(words.props.style).color).not.toBe(colors.lime500);
  });

  /*
   * 360dp with the font at 1.4×: the chip may never wrap or run off the cover. It is bounded to
   * half the cover, its count is one line that shrinks before it overflows, and the longest count
   * it can be asked to print stays short in every language.
   */
  it('stays on one line, inside half the cover, at any font scale', async () => {
    await renderCard({ ...LIVE, viewCount: 999_999_999 });
    expect(StyleSheet.flatten(chip()?.props.style).maxWidth).toBe('50%');
    const words = screen.getByText(compactCount(999_999_999, 'en'), { includeHiddenElements: true });
    expect(words.props.numberOfLines).toBe(1);
    expect(words.props.adjustsFontSizeToFit).toBe(true);
    for (const locale of ['az', 'en', 'ru', 'tr'] as const) {
      expect(compactCount(999_999_999, locale).length).toBeLessThanOrEqual(10);
    }
  });
});

describe('the CLICK', () => {
  it('counts a press with the list the card is in', async () => {
    await renderCard(LIVE, 'en', 'SEARCH');
    await fireEvent.press(screen.getByRole('link'));
    expect(sent).toHaveBeenCalledWith({ kind: 'CLICK', projectId: 'c-1', surface: 'SEARCH' });
  });

  it('is OTHER when the list does not say', async () => {
    await renderCard(LIVE);
    await fireEvent.press(screen.getByRole('link'));
    expect(sent).toHaveBeenCalledWith({ kind: 'CLICK', projectId: 'c-1', surface: 'OTHER' });
  });
});
