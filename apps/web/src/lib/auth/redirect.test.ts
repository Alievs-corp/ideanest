import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNED_IN_PATH,
  RETURN_TO_PARAM,
  isAuthenticationPath,
  safeReturnPath,
  sameOriginPath,
  signInHref,
} from './redirect';

/**
 * The open-redirect guard, which is the one piece of #267 that is a security control rather
 * than a convenience.
 *
 * Every case below is a real technique. A sign-in page that follows an attacker-supplied
 * `?next=` is a link to our own domain, with our own certificate and our own padlock, that
 * hands the reader to somebody else's login form immediately after they have typed their
 * password into ours — and the reader has no way to notice.
 */
describe('safeReturnPath', () => {
  it('keeps a path on this origin, with its query and fragment', () => {
    expect(safeReturnPath('/settings/sessions')).toBe('/settings/sessions');
    expect(safeReturnPath('/settings/sessions?tab=devices')).toBe('/settings/sessions?tab=devices');
    expect(safeReturnPath('/discover#results')).toBe('/discover#results');
  });

  it('refuses an absolute URL, however much it looks like ours', () => {
    expect(safeReturnPath('https://evil.test/login')).toBeNull();
    // The classic: our name is the prefix of somebody else's host.
    expect(safeReturnPath('https://ideanest.az.evil.test/login')).toBeNull();
    expect(safeReturnPath('http://ideanest.az/discover')).toBeNull();
  });

  it('refuses a protocol-relative URL, which no "is it absolute" check catches', () => {
    // A browser resolves both of these against the current scheme and lands on evil.test.
    expect(safeReturnPath('//evil.test/login')).toBeNull();
    expect(safeReturnPath('/\\evil.test/login')).toBeNull();
  });

  it('refuses a scheme that is not navigation at all', () => {
    expect(safeReturnPath('javascript:alert(1)')).toBeNull();
    expect(safeReturnPath('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('refuses a control character, which a browser strips before resolving', () => {
    // `/\tx` is not a path with a tab in it; it is `//evil.test` by the time it is followed.
    expect(safeReturnPath('/\tx//evil.test')).toBeNull();
    expect(safeReturnPath('/\nx')).toBeNull();
    expect(safeReturnPath('/\rx')).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath('   ')).toBeNull();
  });

  it('refuses a return path that is itself an authentication screen', () => {
    // Not an attack, only a loop: signing in would land on the form just completed.
    expect(safeReturnPath('/sign-in')).toBeNull();
    expect(safeReturnPath('/sign-in?next=%2Fsettings')).toBeNull();
    expect(safeReturnPath('/register')).toBeNull();
    expect(safeReturnPath('/verify-email?token=abc')).toBeNull();
  });

  it('does not mistake a path that merely begins with one of those words', () => {
    expect(safeReturnPath('/sign-in-help')).toBe('/sign-in-help');
    expect(safeReturnPath('/registered-campaigns')).toBe('/registered-campaigns');
  });
});

/*
 * #587: the origin half on its own, for the maintenance page's inline script. Escapes are
 * built from char codes so that what is under test is unmistakably the character itself.
 */
describe('sameOriginPath', () => {
  const TAB = String.fromCharCode(9);
  const BACKSLASH = String.fromCharCode(92);

  it('keeps a path on this origin, including an authentication screen', () => {
    expect(sameOriginPath('/az/pledges?page=2#top')).toBe('/az/pledges?page=2#top');
    // No loop rule here: returning to a sign-in form after maintenance is where the reader was.
    expect(sameOriginPath('/sign-in?next=%2Fsettings')).toBe('/sign-in?next=%2Fsettings');
  });

  it('refuses everything safeReturnPath refuses about the origin', () => {
    for (const value of [
      'https://evil.test/x',
      '//evil.test/x',
      `/${BACKSLASH}evil.test`,
      `${BACKSLASH}/evil.test`,
      'javascript:alert(1)',
      `/${TAB}/evil.test`,
      `/${TAB}x//evil.test`,
      '',
      null,
      undefined,
    ]) {
      expect(sameOriginPath(value)).toBeNull();
    }
  });

  it('closes over nothing, so it can be written into an inline script', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const emitted = new Function(`return (${sameOriginPath.toString()});`)() as typeof sameOriginPath;
    expect(emitted('/az/discover')).toBe('/az/discover');
    expect(emitted('//evil.test')).toBeNull();
  });
});

describe('isAuthenticationPath', () => {
  it('covers the routes of app/(auth) and nothing beside them', () => {
    expect(isAuthenticationPath('/sign-in')).toBe(true);
    expect(isAuthenticationPath('/register')).toBe(true);
    expect(isAuthenticationPath('/verify-email')).toBe(true);
    expect(isAuthenticationPath('/settings')).toBe(false);
    expect(isAuthenticationPath('/')).toBe(false);
  });

  /**
   * #271 and #277's landing pages, which joined the group after it was written.
   *
   * The list is hand-maintained because the route tree has no runtime form to derive it
   * from, and a hand-maintained list is one somebody adds a route without joining. These
   * assertions are what makes that a failing test rather than a return path that walks
   * somebody who has just signed in back to the form for people who cannot.
   */
  it('covers the recovery landing pages, including the confirm step under one of them', () => {
    expect(isAuthenticationPath('/reset-password')).toBe(true);
    expect(isAuthenticationPath('/reset-password/confirm')).toBe(true);
    expect(isAuthenticationPath('/confirm-email-change')).toBe(true);
  });

  it('does not claim the settings screens that change the same two credentials', () => {
    // §4.1's A-12 and A-13 are behind the guard rather than in front of it, so they are
    // legitimate return paths: being sent back to `/settings/password` after signing in is
    // exactly what should happen.
    expect(isAuthenticationPath('/settings/password')).toBe(false);
    expect(isAuthenticationPath('/settings/email')).toBe(false);
  });
});

describe('signInHref', () => {
  it('carries the interrupted path, encoded once', () => {
    expect(signInHref('/settings/sessions')).toBe(
      `/sign-in?${RETURN_TO_PARAM}=%2Fsettings%2Fsessions`,
    );
  });

  it('carries the query string with it, so a reader comes back to the same screen', () => {
    expect(signInHref('/settings/sessions?tab=devices')).toBe(
      `/sign-in?${RETURN_TO_PARAM}=%2Fsettings%2Fsessions%3Ftab%3Ddevices`,
    );
  });

  it('is a bare sign-in when there is nothing safe to return to', () => {
    expect(signInHref('/sign-in')).toBe('/sign-in');
    expect(signInHref('//evil.test')).toBe('/sign-in');
  });
});

describe('the default', () => {
  it('is the home page, which exists as of #264', () => {
    expect(DEFAULT_SIGNED_IN_PATH).toBe('/');
  });
});
