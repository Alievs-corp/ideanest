import { isGuarded, safeReturnTo, signInHrefFor } from './guard';

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

/*
 * The web's `lib/auth/redirect.test.ts` table, on a phone (issue #152): every refusal below has
 * been an open redirect somewhere, and an auth path is a loop back into the form just completed.
 */
describe('safeReturnTo', () => {
  it.each([
    ['/campaigns/new?draft=1', '/campaigns/new?draft=1'],
    ['/settings/language', '/settings/language'],
    ['/projects/alice/garden#rewards', '/projects/alice/garden#rewards'],
    ['  /pledges/42  ', '/pledges/42'],
    ['/sign-ins', '/sign-ins'],
    ['/(tabs)/saved', '/(tabs)/saved'],
    ['/projects/a%20b', '/projects/a%20b'],
  ])('keeps %s', (value, kept) => expect(safeReturnTo(value)).toBe(kept));

  it.each([
    ['nothing', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an array param', ['/settings', '/pledges']],
    ['a relative path', 'campaigns/new'],
    ['a protocol-relative URL', '//evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a scheme after the slash', '/javascript:alert(1)'],
    ['a backslash', '/\\evil.example'],
    ['a backslash later on', '/settings\\..\\evil'],
    ['a tab', '/\tx//evil.example'],
    ['a newline', '/settings\n//evil.example'],
    ['a NUL', '/settings\u0000'],
    ['a DEL', '/settings\u007f'],
    ['an inner space', '/settings /evil'],
    ['sign-in', '/sign-in'],
    ['sign-in with a query', '/sign-in?returnTo=/settings'],
    ['register', '/register?x=1'],
    ['the reset request', '/reset-password'],
    ['the reset confirm', '/reset-password/confirm?token=x'],
    ['verify-email', '/verify-email?token=x'],
    ['confirm-email-change', '/confirm-email-change'],
    ['an auth path with a fragment', '/register#top'],
    ['an encoded auth path', '/%73ign-in'],
    ['an encoded protocol-relative URL', '/%2F%2Fevil.example'],
    ['an encoded backslash', '/%5Cevil.example'],
    ['an encoded newline', '/settings%0A'],
    ['malformed escapes', '/settings%E0%A4%A'],
    ['the auth group written out', '/(auth)/sign-in'],
    ['a group in front of an auth path', '/(tabs)/(auth)/register'],
  ])('refuses %s', (_label, value) => expect(safeReturnTo(value)).toBeNull());
});

describe('signInHrefFor', () => {
  it('carries the guarded path as returnTo', () => {
    expect(signInHrefFor('/settings/language')).toEqual({
      pathname: '/sign-in',
      params: { returnTo: '/settings/language' },
    });
  });
});
