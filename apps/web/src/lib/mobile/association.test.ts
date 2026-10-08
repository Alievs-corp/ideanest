import { readdirSync } from 'node:fs';
import path from 'node:path';
import { CLAIMED_ROUTES, isClaimedPath, matchesPattern } from '@ideanest/links/claims';
import { SUPPORTED_LOCALES } from '@ideanest/messages/locale';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as appleRoute } from '../../app/.well-known/apple-app-site-association/route';
import { GET as androidRoute } from '../../app/.well-known/assetlinks.json/route';
import {
  ANDROID_FINGERPRINTS_VARIABLE,
  ANDROID_PACKAGE_VARIABLE,
  IOS_APP_ID_VARIABLE,
  appleAppSiteAssociation,
  assetLinks,
} from './association';

/**
 * Issue #114's web half, and #165's claim. Both platforms fail this file silently — iOS caches a
 * bad association for up to a week and Android just stops verifying — so the shape is asserted
 * rather than eyeballed once and trusted.
 */

type Component = { '/': string; exclude?: boolean };

function configuredAssociation(): unknown {
  return appleAppSiteAssociation({ [IOS_APP_ID_VARIABLE]: 'ABCDE12345.az.ideanest.app' });
}

function componentsOf(association: unknown): Component[] {
  const typed = association as { applinks: { details: { components: Component[] }[] } };
  return typed.applinks.details[0]?.components ?? [];
}

/** What iOS does: the first component that matches decides. */
function firstMatch(components: readonly Component[], urlPath: string): Component | undefined {
  return components.find((component) => matchesPattern(component['/'], urlPath));
}

describe('appleAppSiteAssociation', () => {
  it('is absent when the deployment has no iOS application', () => {
    // A 404 is what both platforms already expect from a site with no app. A
    // placeholder identifier is what they would cache.
    expect(appleAppSiteAssociation({})).toBeNull();
    expect(appleAppSiteAssociation({ [IOS_APP_ID_VARIABLE]: '   ' })).toBeNull();
  });

  it('names the configured application', () => {
    const association = configuredAssociation() as { applinks: { details: { appIDs: string[] }[] } };
    expect(association.applinks.details[0]?.appIDs).toEqual(['ABCDE12345.az.ideanest.app']);
  });

  it('lists every exclude before the first claim', () => {
    const components = componentsOf(configuredAssociation());
    const firstClaim = components.findIndex((component) => component.exclude !== true);
    const lastExclude = components.map((component) => component.exclude === true).lastIndexOf(true);

    // iOS stops at the first component that matches, so an exclude after a claim excludes nothing.
    expect(lastExclude).toBeGreaterThanOrEqual(0);
    expect(firstClaim).toBeGreaterThan(lastExclude);
    const excluded = components.filter((component) => component.exclude === true).map((c) => c['/']);
    for (const pattern of [
      '/admin',
      '/admin/*',
      '/az/admin',
      '/az/admin/*',
      '/api/*',
      '/v1/*',
      '/.well-known/*',
      '/_next/*',
      '/robots.txt',
      '/sitemap.xml',
      '/sitemap_index.xml',
      '/icon*',
      '/apple-icon*',
      '*/opengraph-image*',
    ]) {
      expect(excluded).toContain(pattern);
    }
  });

  it('claims every path of the table, bare and under each locale', () => {
    const claimed = componentsOf(configuredAssociation())
      .filter((component) => component.exclude !== true)
      .map((component) => component['/']);
    for (const route of CLAIMED_ROUTES) {
      for (const pattern of route.paths) {
        expect(claimed).toContain(pattern);
        for (const locale of SUPPORTED_LOCALES) {
          expect(claimed).toContain(pattern === '/' ? `/${locale}` : `/${locale}${pattern}`);
        }
      }
    }
  });

  it('claims no admin path, and hands neither the console nor an OG image to the app', () => {
    const components = componentsOf(configuredAssociation());
    const claims = components.filter((component) => component.exclude !== true);
    expect(claims.some((component) => component['/'].includes('admin'))).toBe(false);
    for (const urlPath of [
      '/admin',
      '/az/admin/users',
      '/ru/admin',
      '/az/projects/x/prelaunch/opengraph-image',
      '/opengraph-image',
      '/en/discover/opengraph-image',
    ]) {
      expect(firstMatch(components, urlPath)?.exclude ?? true, urlPath).toBe(true);
    }
  });

  it('keeps the empty apps array iOS reads as well-formed', () => {
    // Its absence is read as a malformed file rather than as an empty list.
    const association = configuredAssociation() as { applinks: { apps: unknown[] } };

    expect(association.applinks.apps).toEqual([]);
  });
});

describe('assetLinks', () => {
  it('is absent unless both the package and a fingerprint are configured', () => {
    expect(assetLinks({})).toBeNull();
    expect(assetLinks({ [ANDROID_PACKAGE_VARIABLE]: 'az.ideanest.app' })).toBeNull();
    expect(assetLinks({ [ANDROID_FINGERPRINTS_VARIABLE]: 'AA:BB' })).toBeNull();
  });

  it('emits one statement per fingerprint, so a key rotation keeps both live', () => {
    // The old certificate is still on every phone that has not updated. An
    // assetlinks file naming only the new one breaks links on all of them.
    const statements = assetLinks({
      [ANDROID_PACKAGE_VARIABLE]: 'az.ideanest.app',
      [ANDROID_FINGERPRINTS_VARIABLE]: 'aa:bb:cc, dd:ee:ff',
    }) as {
      relation: string[];
      target: { package_name: string; sha256_cert_fingerprints: string[] };
    }[];

    expect(statements).toHaveLength(2);
    expect(statements[0]?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statements[0]?.target.package_name).toBe('az.ideanest.app');
    // Upper-cased, which is the form Play Console prints and compares against.
    expect(statements[0]?.target.sha256_cert_fingerprints).toEqual(['AA:BB:CC']);
    expect(statements[1]?.target.sha256_cert_fingerprints).toEqual(['DD:EE:FF']);
  });

  it('ignores an empty entry in the list rather than emitting a blank statement', () => {
    const statements = assetLinks({
      [ANDROID_PACKAGE_VARIABLE]: 'az.ideanest.app',
      [ANDROID_FINGERPRINTS_VARIABLE]: 'aa:bb, ,',
    }) as unknown[];

    expect(statements).toHaveLength(1);
  });
});

describe('the route handlers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answer 404 when the deployment is not configured', () => {
    vi.stubEnv(IOS_APP_ID_VARIABLE, '');
    vi.stubEnv(ANDROID_PACKAGE_VARIABLE, '');
    vi.stubEnv(ANDROID_FINGERPRINTS_VARIABLE, '');
    expect(appleRoute().status).toBe(404);
    expect(androidRoute().status).toBe(404);
  });

  it('serve the association as JSON when it is', async () => {
    vi.stubEnv(IOS_APP_ID_VARIABLE, 'ABCDE12345.az.ideanest.app');
    const response = appleRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(componentsOf(await response.json())).toEqual(componentsOf(configuredAssociation()));
  });
});

/**
 * Pages the association deliberately leaves to the browser, each with its reason. Empty today:
 * every page the site serves under a locale, except the administration console, has a screen in
 * the application. A page added here needs the reason as its value.
 */
const NOT_CLAIMED: Readonly<Record<string, string>> = {};

/** Every `page.tsx` under `app/[locale]`, as the path the site serves it at, without the locale. */
function webPages(): string[] {
  const root = path.join(__dirname, '..', '..', 'app', '[locale]');
  const pages: string[] = [];
  const walk = (dir: string, segments: readonly string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // A route group, `(site)`, is not part of the URL.
        const inUrl = !/^\(.*\)$/.test(entry.name);
        walk(path.join(dir, entry.name), inUrl ? [...segments, entry.name] : segments);
      } else if (entry.name === 'page.tsx') {
        pages.push(`/${segments.join('/')}`);
      }
    }
  };
  walk(root, []);
  return pages;
}

/** A page's path with each dynamic segment filled in, the way a real link would have it. */
const urlOf = (page: string): string => page.replace(/\[[^\]]+\]/g, 'x');

describe('every page the site serves', () => {
  const pages = webPages();

  it('is found by the walk', () => {
    expect(pages).toContain('/');
    expect(pages).toContain('/projects/[id]/[projectSlug]');
    expect(pages).toContain('/verify-email');
    expect(pages.length).toBeGreaterThan(40);
  });

  it.each(pages.filter((page) => !page.startsWith('/admin')))('%s is claimed, or listed as deliberately not', (page) => {
    const urlPath = urlOf(page);
    if (page in NOT_CLAIMED) {
      expect(isClaimedPath(urlPath)).toBe(false);
      return;
    }
    expect(isClaimedPath(urlPath), urlPath).toBe(true);
    for (const locale of SUPPORTED_LOCALES) {
      const prefixed = urlPath === '/' ? `/${locale}` : `/${locale}${urlPath}`;
      expect(isClaimedPath(prefixed), prefixed).toBe(true);
    }
  });

  it('never hands the administration console to the app', () => {
    const admin = pages.filter((page) => page.startsWith('/admin'));
    expect(admin.length).toBeGreaterThan(0);
    for (const page of admin) {
      expect(isClaimedPath(urlOf(page)), page).toBe(false);
      for (const locale of SUPPORTED_LOCALES) {
        expect(isClaimedPath(`/${locale}${urlOf(page)}`), page).toBe(false);
      }
    }
  });
});
