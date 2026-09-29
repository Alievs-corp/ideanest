import { createElement, type ReactNode } from 'react';
import { createTranslator, IntlProvider, useTranslations } from 'use-intl';
import { renderHook } from '@testing-library/react-native';
import ru from '@ideanest/messages/ru.json';
import en from '@ideanest/messages/en.json';

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
