import { createElement, type ReactNode } from 'react';
import { createTranslator, IntlProvider, useTranslations } from 'use-intl';
import { renderHook } from '@testing-library/react-native';
import ru from '@ideanest/messages/ru.json';
import en from '@ideanest/messages/en.json';
import az from '@ideanest/messages/az.json';
import { formatCount, formatDate, pluralCategory, translate } from './i18n';
import { currentLocale, setLocale } from './locale';

/** The catalogue the app renders from behaves as the web's does under `use-intl`. */
describe('use-intl over the shared catalogue', () => {
  const t = createTranslator({ locale: 'ru', messages: ru });

  it.each([
    [0, 'Ничего не найдено'],
    [1, '1 кампания'],
    [2, '2 кампании'],
    [5, '5 кампаний'],
    [21, '21 кампания'],
  ])('pluralises discovery.search.count at %i in Russian', (count, expected) => {
    expect(t('discovery.search.count', { count })).toBe(expected);
  });

  it('renders a key the catalogue lacks as its own name instead of throwing', () => {
    const tolerant = createTranslator({
      locale: 'en',
      messages: en,
      onError: () => {},
      getMessageFallback: ({ key, namespace }) =>
        namespace === undefined ? key : `${namespace}.${key}`,
    });
    // @ts-expect-error deliberately not a key
    expect(tolerant('mobile.missing')).toBe('mobile.missing');
  });

  it('serves the mobile namespace through the provider', async () => {
    const { result } = await renderHook(() => useTranslations('mobile.tabs'), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(IntlProvider, { locale: 'az', messages: en, children }),
    });
    expect(result.current('me')).toBe('Me');
  });
});

/** The app's own wording and formatting helpers, in the four languages — issue #150. */
describe('the app-only strings and formats', () => {
  it('plurals the search minimum in Russian and keeps the number off a suffix in Azerbaijani', () => {
    const inRussian = createTranslator({ locale: 'ru', messages: ru });
    const inAzerbaijani = createTranslator({ locale: 'az', messages: az });
    expect(inRussian('mobile.search.minimum', { count: 3 })).toBe(
      'Введите хотя бы 3 символа или выберите подсказку.',
    );
    expect(inRussian('mobile.search.minimum', { count: 5 })).toBe(
      'Введите хотя бы 5 символов или выберите подсказку.',
    );
    expect(inAzerbaijani('mobile.search.minimum', { count: 3 })).toBe(
      'Ən azı 3 simvol yazın və ya təkliflərdən birini seçin.',
    );
  });

  it('picks the catalogue form for the web’s {one, few, many, other} objects', () => {
    expect(pluralCategory('ru', 1)).toBe('one');
    expect(pluralCategory('ru', 3)).toBe('few');
    expect(pluralCategory('ru', 11)).toBe('many');
    expect(pluralCategory('en', 2)).toBe('other');
    expect(en.campaign.funding.backers[pluralCategory('en', 1)]).toBe('backer');
  });

  it('formats a count and a date in the language in use, and never shows Invalid Date', () => {
    expect(formatCount(1234, 'en')).toBe('1,234');
    // Day first, as British English writes it; CLDR moved `Sep` to `Sept` in ICU 72.
    expect(formatDate('2026-09-30T10:00:00Z', 'en')).toMatch(/^30 Sept? 2026$/);
    expect(formatDate('not a date', 'en')).toBe('not a date');
    expect(formatDate(undefined, 'en')).toBe('');
  });

  it('translates outside the tree in the language chosen at the moment of the call', () => {
    const before = currentLocale();
    try {
      setLocale('en');
      expect(translate()('mobile.lock.prompt')).toBe('Unlock IdeyaNest');
      setLocale('ru');
      expect(translate()('mobile.lock.stayLocked')).toBe('Оставить заблокированным');
    } finally {
      setLocale(before);
    }
  });
});
