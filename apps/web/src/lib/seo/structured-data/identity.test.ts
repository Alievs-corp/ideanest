import { describe, expect, it } from 'vitest';

import { SITE_NAME } from '../metadata';
import { ORGANIZATION_FRAGMENT, WEBSITE_FRAGMENT, siteIdentityNodes } from './identity';

const env = { IDEANEST_SITE_URL: 'https://ideanest.az' } as const;

describe('siteIdentityNodes', () => {
  it('states the organisation and the site, once each', () => {
    const types = siteIdentityNodes('en', env).map((node) => node['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('identifies both against the configured origin, never a literal', () => {
    const [organization, website] = siteIdentityNodes('en', env);

    expect(organization?.['@id']).toBe(`https://ideanest.az/${ORGANIZATION_FRAGMENT}`);
    expect(organization?.url).toBe('https://ideanest.az/en');
    expect(website?.['@id']).toBe(`https://ideanest.az/${WEBSITE_FRAGMENT}`);
    expect(website?.url).toBe('https://ideanest.az/en');
  });

  it('follows the origin wherever it is configured, so staging never claims production', () => {
    const [organization] = siteIdentityNodes('en', { IDEANEST_SITE_URL: 'https://staging.ideanest.az' });
    expect(organization?.url).toBe('https://staging.ideanest.az/en');
  });

  it('names the site the same way every `<meta>` tag does', () => {
    const [organization, website] = siteIdentityNodes('en', env);

    expect(organization?.name).toBe(SITE_NAME);
    expect(website?.name).toBe(SITE_NAME);
  });

  /**
   * #123. `inLanguage` was `SITE_LANGUAGE` — the constant `<html lang>` used to be built from
   * — which meant `/ru/` told a crawler in machine-readable terms that it was English.
   */
  it('declares the language of the page it is on, not the site’s first one', () => {
    const [, russian] = siteIdentityNodes('ru', env);
    const [, azerbaijani] = siteIdentityNodes('az', env);

    expect(russian?.inLanguage).toBe('ru');
    expect(azerbaijani?.inLanguage).toBe('az');
  });

  /**
   * The identifier is a name for a thing rather than an address, and there is one IdeyaNest.
   * Four `@id`s would be four organisations across a crawl of four languages.
   */
  it('keeps one identifier for the organisation across every language', () => {
    const identifiers = new Set(
      (['az', 'en', 'ru', 'tr'] as const).map((locale) => siteIdentityNodes(locale, env)[0]?.['@id']),
    );

    expect(identifiers).toEqual(new Set([`https://ideanest.az/${ORGANIZATION_FRAGMENT}`]));
  });

  it('points the site at the organisation by reference rather than repeating it', () => {
    const [, website] = siteIdentityNodes('en', env);
    expect(website?.publisher).toEqual({ '@id': `https://ideanest.az/${ORGANIZATION_FRAGMENT}` });
  });

  it('claims no logo, no social profile, and no search action', () => {
    for (const node of siteIdentityNodes('en', env)) {
      expect(node).not.toHaveProperty('logo');
      expect(node).not.toHaveProperty('sameAs');
      expect(node).not.toHaveProperty('potentialAction');
    }
  });
});
