import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';

/**
 * Every screen a signed-in reader meets, against every language — issue #324.
 *
 * <h2>What this covers that `lib/i18n/catalogue.test.ts` does not</h2>
 *
 * That file asserts properties of the catalogue: that the four languages hold the same keys,
 * that none is empty, that rich-text tags match. It cannot see whether a *page* actually asks
 * for any of it. A screen that was translated and then quietly rewritten with a literal back
 * in it passes every catalogue check while showing English to everybody.
 *
 * So these read the pages' own source. It is a coarse instrument and a deliberate one: the
 * panels below each header fetch with a bearer token, and a test that mounted them would be a
 * test of the fetch mocks rather than of the copy.
 */
const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };

/** Catalogue namespace, and the route whose `page.tsx` should be drawing from it. */
const SCREENS: ReadonlyArray<readonly [namespace: string, route: string]> = [
  ['settings.pages.profile', 'settings/profile'],
  ['settings.pages.notifications', 'settings/notifications'],
  ['settings.pages.sessions', 'settings/sessions'],
  ['settings.pages.email', 'settings/email'],
  ['settings.pages.password', 'settings/password'],
  ['settings.pages.security', 'settings/security'],
  ['settings.pages.privacy', 'settings/privacy'],
  ['settings.pages.payout', 'settings/payout'],
  ['account.pages.saved', 'account/saved'],
  ['account.pages.following', 'account/following'],
  ['account.pages.surveys', 'account/surveys'],
  ['account.pages.deliveries', 'account/deliveries'],
  ['account.pages.pledges', 'pledges'],
  ['account.pages.pledgeDetail', 'pledges/[pledgeId]'],
  ['account.pages.inbox', 'notifications'],
];

function sourceOf(route: string): string {
  return readFileSync(join(process.cwd(), 'src/app/[locale]', route, 'page.tsx'), 'utf8');
}

function messagesAt(locale: Locale, namespace: string): Record<string, string> {
  let node: unknown = CATALOGUES[locale];
  for (const segment of namespace.split('.')) {
    node = (node as Record<string, unknown>)[segment];
  }
  return node as Record<string, string>;
}

describe('the signed-in screens', () => {
  it.each(SCREENS)('%s is drawn from the catalogue', (namespace, route) => {
    const source = sourceOf(route);

    expect(source).toContain(`getTranslations('${namespace}')`);
    expect(source).toContain("t('title')");
    /* The tab title is the one piece a reader sees before the page paints. */
    expect(source).toContain("t('metaTitle')");
    expect(source).toContain("t('metaDescription')");
    expect(source).toMatch(/t(\.rich)?\('intro'/u);
  });

  it.each(SUPPORTED_LOCALES)('has a complete %s translation for every screen', (locale) => {
    for (const [namespace] of SCREENS) {
      const messages = messagesAt(locale, namespace);

      for (const key of ['metaTitle', 'metaDescription', 'title', 'intro']) {
        expect(messages[key], `${locale} ${namespace}.${key}`).toBeTypeOf('string');
      }
    }
  });

  it.each(SCREENS)('%s supplies a renderer for every tag its languages use', (namespace, route) => {
    /*
     * `catalogue.test.ts` already asserts that the four languages agree on tags. This is the
     * other half: that the page provides a function for each of them. A translation and a call
     * site can agree with each other and both disagree with the component — `t.rich` throws
     * at render, in one language only, on a screen the reviewer is not reading in it.
     */
    const source = sourceOf(route);
    const call = /t\.rich\('intro', \{(.*?)\n\s*\}\)\}/s.exec(source);
    const provided = new Set(
      [...(call?.[1] ?? '').matchAll(/^\s*(\w+):/gmu)].map((match) => match[1] as string),
    );

    for (const locale of SUPPORTED_LOCALES) {
      const used = [...messagesAt(locale, namespace)['intro']!.matchAll(/<(\w+)>/gu)].map(
        (match) => match[1] as string,
      );

      for (const tag of used) {
        expect(
          provided.has(tag),
          `${locale} ${namespace}.intro uses <${tag}> and ${route}/page.tsx supplies no renderer`,
        ).toBe(true);
      }
    }
  });

  it('leaves no English sentence in the headers these screens own', () => {
    /*
     * A guard against the regression rather than the original defect: the next person editing
     * one of these reaches for a sentence and types it in. Every heading and introduction goes
     * through `t`, so what sits between the header tags should be an expression, never prose.
     */
    for (const [, route] of SCREENS) {
      const source = sourceOf(route);
      const header = /<AccountPageHeader[^>]*>(.*?)<\/AccountPageHeader>/s.exec(source);
      if (header === null) continue;

      expect(header[1] ?? '', `${route} header`).not.toMatch(/^\s*[A-Z][a-z]+ [a-z]/u);
    }
  });
});
