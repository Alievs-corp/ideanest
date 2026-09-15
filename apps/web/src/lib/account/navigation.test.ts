import { describe, expect, it } from 'vitest';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/locale';
import { SESSION_REQUIRED_PATHS } from '../session/private-routes';
import {
  ACCOUNT_GROUPS,
  ACCOUNT_LINKS,
  accountLinkFor,
  isCurrentAccountLink,
} from './navigation';

/**
 * §4.2's account navigation — issue #275.
 *
 * WHAT THESE COVER:
 *
 *   - **every entry points at a route this application serves.** `components/shell/navigation.ts`
 *     has the same test for the same reason, and it matters more here: an account navigation is
 *     exactly where somebody adds the entry before the page.
 *   - **every entry is behind the session guard.** Each of these screens reads one person's own
 *     data, so a path that `requiresSession` does not match is a path an anonymous visitor
 *     reaches and gets a wall of 401s on.
 *   - the current-page match is exact. A prefix match would be a second answer to a question
 *     `isCurrent` already answers differently for the site header, and the difference is
 *     deliberate.
 *   - **every key resolves in all four languages** (§21.1, #324). The entries stopped being
 *     English sentences and became addresses into `messages/*.json`, which moves the way this
 *     list breaks: not a label that reads badly, but a label that is not there. A missing
 *     Turkish string renders `account.links.language.label` in production — `i18n/request.ts`
 *     chooses that over a 500 — and nothing else in the suite would notice.
 */

const ROUTES_THAT_EXIST = new Set([
  /*
   * #287's pledge manager, which is the one entry not under `/account` or `/settings` —
   * `navigation.ts` argues why the URL could not move. The list here is deliberately a
   * literal set rather than anything derived from the navigation itself: a test that read
   * its expectation from the thing under test would pass for any navigation at all.
   */
  '/pledges',
  '/account/campaigns',
  '/account/saved',
  '/account/following',
  '/account/surveys',
  '/account/deliveries',
  '/settings/profile',
  '/settings/notifications',
  '/settings/sessions',
  '/settings/email',
  '/settings/password',
  '/settings/security',
  '/settings/privacy',
  // IDN-EXT-01 (#44): the payout details page.
  '/settings/payout',
  // #280's language preference, P-10's half that a system with one currency can actually offer.
  '/settings/language',
]);

/**
 * The four catalogues, keyed by the tag `SUPPORTED_LOCALES` names them with.
 *
 * STATIC IMPORTS RATHER THAN A DIRECTORY READ, so a language file that fails to parse is a
 * failure here at build time rather than at the first render in that language. The keys are
 * typed against `Locale`, which is what makes a fifth language added to `SUPPORTED_LOCALES`
 * and not to this map a typecheck error instead of a test that quietly covers three of four.
 */
const CATALOGUES: Record<Locale, unknown> = { az, en, ru, tr };

/** One message by its dotted path, or `undefined` — the lookup next-intl performs internally. */
function message(catalogue: unknown, path: readonly string[]): unknown {
  let current: unknown = catalogue;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** The same matcher `SessionProvider` guards with, kept in step by importing the list. */
function guarded(pathname: string): boolean {
  return SESSION_REQUIRED_PATHS.some((pattern) => {
    const patternSegments = pattern.split('/');
    const pathSegments = pathname.split('/');
    if (pathSegments.length < patternSegments.length) return false;
    return patternSegments.every(
      (segment, index) => segment === '*' || segment === pathSegments[index],
    );
  });
}

describe('the account navigation', () => {
  it('points only at routes that exist', () => {
    for (const link of ACCOUNT_LINKS) {
      expect(ROUTES_THAT_EXIST, `${link.href} is in the account navigation`).toContain(link.href);
    }
  });

  it('lists every route that exists, so a built screen is not unreachable', () => {
    expect(new Set(ACCOUNT_LINKS.map((link) => link.href))).toEqual(ROUTES_THAT_EXIST);
  });

  it('puts every entry behind the session guard', () => {
    for (const link of ACCOUNT_LINKS) {
      expect(guarded(link.href), `${link.href} requires a session`).toBe(true);
    }
  });

  it('names every entry by a key rather than by a sentence', () => {
    for (const link of ACCOUNT_LINKS) {
      expect(link.key.trim()).not.toBe('');
    }
    for (const group of ACCOUNT_GROUPS) {
      expect(group.headingKey.trim()).not.toBe('');
    }
  });

  it('resolves every key in all four languages', () => {
    // Guards the map above: three catalogues checked out of four is a passing test and a
    // broken language.
    expect(Object.keys(CATALOGUES).sort()).toEqual([...SUPPORTED_LOCALES].sort());

    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const group of ACCOUNT_GROUPS) {
        const heading = message(catalogue, ['account', 'groups', group.headingKey]);
        expect(heading, `account.groups.${group.headingKey} in ${locale}`).toEqual(
          expect.any(String),
        );
        expect(String(heading).trim()).not.toBe('');
      }

      for (const link of ACCOUNT_LINKS) {
        for (const field of ['label', 'summary'] as const) {
          const text = message(catalogue, ['account', 'links', link.key, field]);
          expect(text, `account.links.${link.key}.${field} in ${locale}`).toEqual(
            expect.any(String),
          );
          expect(String(text).trim()).not.toBe('');
        }
      }
    }
  });

  it('gives each entry its own key, so two destinations cannot share one label', () => {
    const keys = ACCOUNT_LINKS.map((link) => link.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('offers the profile editor, which #276 gave an endpoint to save to', () => {
    /*
     * This assertion used to be its own inverse, and the comment under it said the service
     * had no `PATCH /v1/me`, so an entry here would be a form with nowhere to save. #276 built
     * `GET /v1/me/profile` and `PATCH /v1/me/profile` — a named pair rather than the account
     * patch that was asked for, for the reason `OwnProfileController` gives — so the entry is
     * now the correct one and its absence would be the defect.
     */
    expect(ACCOUNT_LINKS.map((link) => link.href)).toContain('/settings/profile');
  });

  it('puts the profile first among the settings, as the only one about what strangers see', () => {
    const settings = ACCOUNT_GROUPS.find((group) => group.headingKey === 'settings');
    expect(settings?.links[0]?.href).toBe('/settings/profile');
  });

  it('offers the language preference #324 gave a catalogue to switch between', () => {
    /*
     * This assertion used to be its own inverse too, and `navigation.ts` said P-10 was blocked
     * on §21.1. It is not any more: the four message files exist and `/settings/language` is a
     * page. Only the language half — a display-currency control would convert AZN to AZN.
     */
    expect(ACCOUNT_LINKS.map((link) => link.href)).toContain('/settings/language');
  });

  it('puts the language last among the settings, below the two irreversible entries', () => {
    const settings = ACCOUNT_GROUPS.find((group) => group.headingKey === 'settings');
    expect(settings?.links.at(-1)?.href).toBe('/settings/language');
  });

  it('groups them by the question being asked rather than by URL prefix', () => {
    expect(ACCOUNT_GROUPS.map((group) => group.headingKey)).toEqual(['yourAccount', 'settings']);
  });
});

describe('isCurrentAccountLink', () => {
  it('is exact', () => {
    expect(isCurrentAccountLink('/settings/security', '/settings/security')).toBe(true);
    expect(isCurrentAccountLink('/settings', '/settings/security')).toBe(false);
    expect(isCurrentAccountLink('/account/saved', '/account/saved-later')).toBe(false);
  });
});

describe('accountLinkFor', () => {
  it('finds the entry for a path, and answers null for one that is not ours', () => {
    expect(accountLinkFor('/account/surveys')?.key).toBe('surveys');
    expect(accountLinkFor('/pledges/abc/address')).toBeNull();
  });
});
