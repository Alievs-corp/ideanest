import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../../lib/i18n/locale';

/**
 * The six screens somebody meets before they have an account — issue #324.
 *
 * <h2>What this covers that the catalogue test does not</h2>
 *
 * `lib/i18n/catalogue.test.ts` asserts properties of the messages and cannot see whether a
 * *page* asks for any of them: a route rewritten with a literal back in it passes every
 * catalogue check while showing English to everybody. `account-area.pages.test.ts` makes the
 * same argument for the signed-in screens and this is its counterpart for the public half.
 *
 * <h2>Why these routes deserve their own guard</h2>
 *
 * They are the first pages a stranger sees, and the only ones somebody who cannot get in can
 * reach. A key that was never added renders as `auth.signIn.submit` under
 * `getMessageFallback`, and on this route that is the label of the button somebody has to
 * press to reach their pledges. Everywhere else in the application a missing string is a
 * blemish; here it is a locked door.
 *
 * <p>It reads the pages' own source rather than rendering them. Each one is a server component
 * that awaits a copy accessor and hands the object to a client form, and a test that mounted
 * it would be a test of the mock behind `next-intl/server`.
 */
const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };

/**
 * Catalogue namespace, the route whose `page.tsx` should be drawing from it, and the accessor
 * that page is expected to call.
 */
const SCREENS: ReadonlyArray<
  readonly [namespace: string, route: string, accessor: string]
> = [
  ['signIn', 'sign-in', 'signInCopy'],
  ['register', 'register', 'registerCopy'],
  ['reset', 'reset-password', 'passwordResetCopy'],
  ['resetConfirm', 'reset-password/confirm', 'passwordResetConfirmCopy'],
  ['verifyEmail', 'verify-email', 'verifyEmailCopy'],
  ['emailChange', 'confirm-email-change', 'emailChangeCopy'],
];

function sourceOf(route: string): string {
  return readFileSync(join(process.cwd(), 'src/app/[locale]/(auth)', route, 'page.tsx'), 'utf8');
}

function messagesAt(locale: Locale, namespace: string): Record<string, string> {
  let node: unknown = CATALOGUES[locale];
  for (const segment of `auth.${namespace}`.split('.')) {
    node = (node as Record<string, unknown>)[segment];
  }
  return node as Record<string, string>;
}

describe('the authentication screens', () => {
  it.each(SCREENS)('auth.%s is drawn from the catalogue', (namespace, route, accessor) => {
    const source = sourceOf(route);

    /*
     * The tab title is the one piece a reader sees before the page paints, and it followed the
     * build rather than the reader until #324. A `const metadata` cannot read a request, so the
     * assertion is that the route exports the async form.
     */
    expect(source).toContain(`getTranslations('auth.${namespace}')`);
    expect(source).toContain("t('metaTitle')");
    expect(source).toContain("t('metaDescription')");

    /* And that the form below it is handed words rather than left to carry its own. */
    expect(source).toContain(`${accessor}()`);
    expect(source).toContain('copy=');
  });

  it.each(SUPPORTED_LOCALES)('has a complete %s translation for every screen', (locale) => {
    for (const [namespace] of SCREENS) {
      const messages = messagesAt(locale, namespace);

      for (const key of ['metaTitle', 'metaDescription']) {
        expect(messages[key], `${locale} auth.${namespace}.${key}`).toBeTypeOf('string');
      }
    }
  });

  it('leaves no English sentence in the frame these routes share', () => {
    /*
     * A guard against the regression rather than the original defect. The layout's footer is
     * the one sentence every one of these pages carries, and it is the easiest to retype: it
     * is a fixed marketing line that reads as decoration rather than as copy.
     */
    const layout = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(auth)/layout.tsx'),
      'utf8',
    );

    expect(layout).toContain("t('layout.footer')");
    expect(layout).not.toMatch(/Reward-based crowdfunding/u);
  });

  it('states the reset link lifetime once, for both screens that print it', () => {
    /*
     * It was `RESET_LINK_LIFETIME` in `lib/auth/passwordReset.ts` until #324, and the property
     * that constant existed for has to survive the move: `/reset-password` says the lifetime on
     * its confirmation and `/reset-password/confirm` says it twice more, and two spellings of
     * one hour is how a link ends up described differently on two pages about it.
     */
    for (const locale of SUPPORTED_LOCALES) {
      const reset = messagesAt(locale, 'reset');
      const confirm = messagesAt(locale, 'resetConfirm');

      expect(reset['lifetime'], `${locale} auth.reset.lifetime`).toBeTypeOf('string');
      expect(confirm['lifetime'], `${locale} has no second spelling`).toBeUndefined();

      for (const key of ['sentLifetime'] as const) {
        expect(reset[key], `${locale} auth.reset.${key}`).toContain('{lifetime}');
      }
      for (const key of ['intro', 'deadExplain'] as const) {
        expect(confirm[key], `${locale} auth.resetConfirm.${key}`).toContain('{lifetime}');
      }
    }
  });
});
