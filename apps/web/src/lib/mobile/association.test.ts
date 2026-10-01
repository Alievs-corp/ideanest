import { describe, expect, it } from 'vitest';
import {
  ANDROID_FINGERPRINTS_VARIABLE,
  ANDROID_PACKAGE_VARIABLE,
  IOS_APP_ID_VARIABLE,
  appleAppSiteAssociation,
  assetLinks,
} from './association';

/**
 * Issue #114's web half. Both platforms fail this file silently — iOS caches a
 * bad association for up to a week and Android just stops verifying — so the
 * shape is asserted rather than eyeballed once and trusted.
 */

describe('appleAppSiteAssociation', () => {
  it('is absent when the deployment has no iOS application', () => {
    // A 404 is what both platforms already expect from a site with no app. A
    // placeholder identifier is what they would cache.
    expect(appleAppSiteAssociation({})).toBeNull();
    expect(appleAppSiteAssociation({ [IOS_APP_ID_VARIABLE]: '   ' })).toBeNull();
  });

  it('claims the campaign path and nothing else', () => {
    const association = appleAppSiteAssociation({
      [IOS_APP_ID_VARIABLE]: 'ABCDE12345.az.ideanest.app',
    }) as {
      applinks: {
        apps: unknown[];
        details: { appIDs: string[]; components: { '/': string }[] }[];
      };
    };

    expect(association.applinks.details[0]?.appIDs).toEqual(['ABCDE12345.az.ideanest.app']);
    expect(association.applinks.details[0]?.components[0]?.['/']).toBe('/projects/*');
    // #153: the home page, the feed and search, exactly — nothing under them.
    expect(association.applinks.details[0]?.components.slice(1).map((c) => c['/'])).toEqual([
      '/',
      '/discover',
      '/search',
    ]);
  });

  it('keeps the empty apps array iOS reads as well-formed', () => {
    // Its absence is read as a malformed file rather than as an empty list.
    const association = appleAppSiteAssociation({
      [IOS_APP_ID_VARIABLE]: 'ABCDE12345.az.ideanest.app',
    }) as { applinks: { apps: unknown[] } };

    expect(association.applinks.apps).toEqual([]);
  });
});

describe('assetLinks', () => {
  it('is absent unless both the package and a fingerprint are configured', () => {
    expect(assetLinks({})).toBeNull();
    expect(assetLinks({ [ANDROID_PACKAGE_VARIABLE]: 'az.ideanest.app' })).toBeNull();
    expect(
      assetLinks({ [ANDROID_FINGERPRINTS_VARIABLE]: 'AA:BB' }),
    ).toBeNull();
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
