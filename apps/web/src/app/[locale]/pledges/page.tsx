import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../components/account/AccountPageHeader';
import { PledgeList } from '../../../components/pledges/PledgeList';
import { privatePageMetadata } from '../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';
import { pledgeListCopy } from '../../../lib/i18n/shell-copy.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.pledges');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/pledges` — the index of the caller's own pledges. §4.5 PL-09 and PL-10, issue #287.
 *
 * <h2>Why the index is `/pledges` itself, and not `/account/pledges`</h2>
 *
 * §4.2's note describes the account area as one navigation over two prefixes: `/settings/*`
 * for what somebody decides, `/account/*` for what they have. A list of pledges is plainly
 * "what they have", so `/account/pledges` is the tidier-looking address and it is the wrong
 * one. Three reasons, in the order they matter:
 *
 *   1. **The children are already here.** `/pledges/{id}/address` shipped with #290, and
 *      `/pledges/{id}` is this issue's. An index at `/account/pledges` whose every row links
 *      to `/pledges/{id}` would put one feature under two prefixes, and the first person to
 *      wonder which is canonical would be right to.
 *   2. **`/pledges` is already in the route guard.** `lib/session/private-routes.ts` lists it
 *      as a session-required prefix and has since #290 — so the address is spoken for, is
 *      protected, and currently answers 404. A guarded path with no page is a gap rather than
 *      a design.
 *   3. That note is explicit that the split is "a fact about the existing URLs rather than a
 *      design". It is a description of where things ended up, not a rule to extend into a
 *      tree that already exists.
 *
 * The cost is that this page is not in `lib/account/navigation.ts`, so nothing in the account
 * rail points at it. That is a gap and it is named rather than papered over: adding the entry
 * is a one-line change to a file this pull request does not own, and it is reported to the
 * coordinator instead of made here.
 *
 * <h2>The frame, and the empty navigation state</h2>
 *
 * `app/pledges/layout.tsx` already wraps everything under this prefix in `AccountArea`, and
 * its comment says no navigation entry matches these paths — which was correct for a screen
 * somebody is sent to. This one is a destination, which is exactly what changes that.
 *
 * <h2>A client boundary, and no server render</h2>
 *
 * Every row is somebody's own money, read with a bearer token that only the browser holds.
 * There is nothing here for a crawler and nothing to put in the initial HTML, so the page is
 * a heading and a boundary — the same shape every other account screen takes.
 */
export default async function PledgesPage() {
  // Words, not data: the list is a client island behind a bearer token, so the route resolves
  // its sentences and the twelve pledge states, and hands them down.
  const [t, copy] = await Promise.all([
    getTranslations('account.pages.pledges'),
    pledgeListCopy(),
  ]);

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t('intro')}
      </AccountPageHeader>

      <div className="mt-8">
        <PledgeList copy={copy} />
      </div>
    </>
  );
}
