import { isGuarded, safeNext, signInHrefFor } from './guard';

describe('isGuarded', () => {
  it.each([
    '/settings',
    '/settings/language',
    '/account/campaigns',
    '/notifications',
    '/campaigns/new',
    '/campaigns/6f1c/edit/story',
    '/campaigns/6f1c/dashboard',
    '/campaigns/6f1c/dashboard/finance',
    '/pledges/42',
  ])('guards %s', (path) => expect(isGuarded(path)).toBe(true));

  it.each([
    '/',
    '/pricing',
    '/campaigns/6f1c/back',
    '/campaigns/6f1c/prelaunch',
    '/projects/alice/back',
    '/settingsx',
  ])('leaves %s public', (path) => expect(isGuarded(path)).toBe(false));
});

describe('safeNext', () => {
  it('keeps an app-relative path with its query', () => {
    expect(safeNext('/campaigns/new?draft=1')).toBe('/campaigns/new?draft=1');
  });

  it.each([
    null,
    undefined,
    '',
    'campaigns/new',
    '//evil.example',
    'https://evil.example',
    '/\\evil',
    '/sign-in',
    '/register?x=1',
  ])('refuses %s', (value) => expect(safeNext(value)).toBeNull());
});

describe('signInHrefFor', () => {
  it('carries the guarded path as next', () => {
    expect(signInHrefFor('/settings/language')).toEqual({
      pathname: '/sign-in',
      params: { next: '/settings/language' },
    });
  });
});
