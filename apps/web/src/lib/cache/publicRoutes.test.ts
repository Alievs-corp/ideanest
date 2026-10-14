import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../i18n/locale';
import { PUBLIC_PAGE_CACHE_CONTROL, publicCacheControl } from './publicRoutes';

/**
 * Which pages a shared cache may hold — issue #127.
 *
 * WHAT THESE COVER, and the second one is the whole reason this is a function:
 *
 *   - **the public pages are marked public**, in every language, because the cache key is the
 *     path and each language is a different document.
 *   - **NOTHING THAT BELONGS TO ONE PERSON IS.** The campaign's public page is
 *     `/projects/{id}/{slug}` and the creator's editor is `/projects/{id}/edit`; a path pattern
 *     in `next.config.mjs` that matched the first would match the second, and the shape of that
 *     mistake is a creator's unpublished draft marked publicly cacheable. Every private
 *     section is named below and asserted against.
 *   - **an unrecognised path gets nothing**, so the framework's own `private, no-store` stands.
 *     A default that leaked would be a default nobody thought about.
 */

const PUBLIC = [
  '',
  '/discover',
  '/search',
  '/categories',
  '/categories/games',
  '/categories/games/tabletop',
  '/collections',
  '/collections/spring-2027',
  '/about',
  '/how-it-works',
  '/trust-safety',
  '/support',
  '/legal',
  '/legal/terms-of-use',
  '/legal/terms-of-use/v/3',
  '/u/ayan',
  '/projects/0193f2a1/a-folding-bicycle',
];

const PRIVATE = [
  '/account',
  '/account/saved',
  '/settings',
  '/settings/password',
  '/pledges',
  '/pledges/7b1c',
  '/notifications',
  '/admin',
  '/admin/ledger',
  '/sign-in',
  '/register',
  '/projects/new',
  '/projects/0193f2a1/edit',
  '/projects/0193f2a1/edit/rewards',
  '/projects/0193f2a1/dashboard',
  '/projects/0193f2a1/dashboard/backers',
  '/projects/0193f2a1/back',
  '/projects/0193f2a1/prelaunch',
];

describe('marking a page cacheable by a shared cache', () => {
  it.each(SUPPORTED_LOCALES)('holds every public page in %s', (locale) => {
    for (const path of PUBLIC) {
      expect(publicCacheControl(`/${locale}${path}`), path).toBe(PUBLIC_PAGE_CACHE_CONTROL);
    }
  });

  it.each(SUPPORTED_LOCALES)('holds nothing that belongs to one person, in %s', (locale) => {
    for (const path of PRIVATE) {
      expect(publicCacheControl(`/${locale}${path}`), path).toBeNull();
    }
  });

  it('says nothing about a path with no language, which never reaches a render', () => {
    expect(publicCacheControl('/discover')).toBeNull();
    expect(publicCacheControl('/')).toBeNull();
    expect(publicCacheControl('/xx/discover')).toBeNull();
  });

  it('refuses a trailing slash rather than normalising it into a second address', () => {
    expect(publicCacheControl('/az/discover/')).toBeNull();
  });

  it('is a minute for a shared cache and says how long stale may be served', () => {
    expect(PUBLIC_PAGE_CACHE_CONTROL).toContain('public');
    expect(PUBLIC_PAGE_CACHE_CONTROL).toContain('s-maxage=60');
    expect(PUBLIC_PAGE_CACHE_CONTROL).toContain('stale-while-revalidate=');
  });
});
