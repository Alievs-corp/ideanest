import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProfileAbout } from '../../../../components/profile/ProfileAbout';
import { ProfileCampaignGrid } from '../../../../components/profile/ProfileCampaignGrid';
import { ProfileHeader } from '../../../../components/profile/ProfileHeader';
import { FollowControl } from '../../../../components/profile/FollowControl';
import { ProfileReportControl } from '../../../../components/profile/ProfileReportControl';
import { ProfileTabs, type ProfileTab } from '../../../../components/profile/ProfileTabs';
import { CreatorObligationSummary } from '../../../../components/profile/CreatorObligationSummary';
import { fetchCreatorObligations } from '../../../../lib/obligations/server';
import type { Page } from '../../../../lib/community/signals';
import type { ProfileProjectCard, PublicProfile } from '../../../../lib/profiles/api';
import {
  fetchBackedProjects,
  fetchCreatedProjects,
  fetchPublicProfile,
} from '../../../../lib/profiles/server';
import { privatePageMetadata, publicPageMetadata, truncateAtWord } from '../../../../lib/seo/metadata';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { fillPlaceholders } from '../../../../lib/i18n/placeholders';
import {
  followControlCopy,
  profileCopy,
  reportControlCopy,
} from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

/**
 * The public profile — §4.2 P-04 to P-07, at `/u/{slug}`. Issue #274.
 *
 * <h2>Server-rendered, and the 404 is the reason</h2>
 *
 * `lib/profiles/server.ts` carries the full argument. In short: an unknown slug, a closed
 * account and a private profile are one answer, and that answer is only worth anything if it
 * arrives as a **404 status**. A client-rendered page has already sent 200 by the time it can
 * know, so the best it could manage is not-found text under a successful response — a soft
 * 404, which a crawler indexes and goes on requesting. `notFound()` here sends the real thing,
 * and `app/u/not-found.tsx` is what it renders.
 *
 * The same read produces the page and its `<head>`, and it is one request: Next deduplicates
 * `fetch` within a render and both calls go through the same Data Cache entry, exactly as the
 * campaign page relies on.
 *
 * <h2>Both lists are fetched here, and neither is fetched again in the browser</h2>
 *
 * The created list and the backed archive are two requests on the server, both cached for the
 * minute every public read in this application is. A tab that fetched on activation would save
 * a request for the visitor who never opens it and would cost a loading state inside a widget
 * somebody has just pressed a key to reach — and it would leave a crawler, which fires no
 * clicks, reading a profile with one of its two lists missing.
 *
 * `ProfileCampaignGrid` is handed those pages as a seed and only ever asks for what comes
 * after them.
 *
 * <h2>A list that could not be read is not an empty list</h2>
 *
 * `null` from either reader is the service refusing or being unreachable, and the panel says
 * so. Printing "no campaigns yet" over a restarting service would tell a reader something
 * false about a person, which is worse on a profile than almost anywhere else.
 *
 * <h2>Motion: none</h2>
 *
 * Not a budget line so much as an absence of anything to reveal. docs/motion-system.md §8
 * forbids animating a list of cards, the tab panels are already in the document, and the one
 * `FadeUp` this system allows on a first screen would here be a heading fading in over content
 * that arrived with it.
 */

/** The route's own path, for the canonical URL. */
function pathOf(slug: string): string {
  return `/u/${encodeURIComponent(slug)}`;
}

/**
 * What the page says about itself.
 *
 * A profile that cannot be read gets `privatePageMetadata`: `noindex`, `nofollow`, no
 * canonical and **no Open Graph block at all**. That last part is the point rather than
 * tidiness — without it, a link to a hidden profile pasted into a chat would unfurl as an
 * IdeaNest card and imply there is somebody behind it, which is the leak the 404 exists to
 * prevent, restated in a preview image.
 *
 * The description is the biography when there is one and a plain sentence when there is not.
 * It is never the counts: a social card is cached by every unfurler that renders it, so a
 * number in one is a number that will be wrong (`PublicProjectPreview` makes the same rule).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const [profile, t] = await Promise.all([fetchPublicProfile(slug), getTranslations('profile')]);

  if (profile === null) {
    return privatePageMetadata({ title: t('notFound') });
  }

  const bio = profile.bio === null ? '' : profile.bio.trim();

  return publicPageMetadata({
    /*
     * The name is the title in every language — it is a person's, not a word. What #324
     * changed is the sentence around it, which is written by this platform and was English on
     * a page served at /az/u/…
     */
    title: profile.name,
    description:
      bio === '' ? t('metaDescription', { name: profile.name }) : truncateAtWord(bio),
    path: pathOf(slug),
    locale: localeOrDefault(locale),
  });
}

/**
 * The count for a tab, when the page is allowed to know one.
 *
 * `GET /v1/users/{slug}` carries no totals, for the module-boundary reason
 * `lib/profiles/api.ts` records: `user` is the module everything depends on, and counting
 * campaigns or pledges would make it depend on `project` and `pledge` in turn.
 *
 * So the only figure available is the length of a list this page has loaded — which is the
 * total **exactly when there is no next cursor**, and a fraction of it otherwise. A single
 * page is therefore counted and a paginated one is not, rather than the tab printing "24"
 * beside a creator with two hundred campaigns. A wrong number is not a smaller version of the
 * right one; it is a number a reader cannot tell apart from a right one.
 *
 * A list that failed to load has no count either: `null` is not zero.
 */
function knownTotal(page: Page<ProfileProjectCard> | null): { count?: number } {
  if (page === null || page.nextCursor !== null) return {};
  return { count: page.items.length };
}

/*
 * `ProfileCampaignGrid` takes the failed read as well as the successful one, rather than this
 * page rendering an alert of its own. The reason is a build constraint rather than a
 * preference: this file is a Server Component, and `InlineAlert` is reachable only through the
 * `@ideanest/ui` barrel, which pulls `createContext` into the server graph and fails
 * `next build` naming a component the page never used (`packages/ui/src/server.ts`).
 *
 * It is also the better shape. "This list could not be loaded" is a state of the list, and the
 * component that owns the list is the one that should say so.
 */

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: requested, slug } = await params;
  const locale = localeOrDefault(requested);

  const profile: PublicProfile | null = await fetchPublicProfile(slug);
  if (profile === null) notFound();

  /*
   * The lists are fetched only once the profile is known to exist. Asking for them first would
   * put two requests on the service for every crawl of a slug nobody has — and would ask about
   * a person the first read is about to say nothing about.
   */
  /*
   * §5.5's clock joins the two lists rather than being a fourth round trip: it is read for the
   * same page, from the same origin, under the same profile tag, and a creator with a late
   * campaign is exactly the profile a reader is about to make a decision on.
   *
   * `null` -- a refused read -- draws nothing, unlike the two lists. There is a real difference:
   * "this list could not be loaded" is a statement about the page, and "this creator has two
   * late campaigns" is a statement about a person. Guessing at the second one, or apologising
   * for not being able to make it, are both worse than saying nothing.
   */
  const [created, backed, obligations, copy, followCopy, reportCopy] = await Promise.all([
    fetchCreatedProjects(slug),
    fetchBackedProjects(slug),
    fetchCreatorObligations(slug),
    profileCopy(),
    followControlCopy(),
    reportControlCopy(),
  ]);

  const tabs: readonly ProfileTab[] = [
    {
      key: 'created',
      label: copy.tabs.created,
      ...knownTotal(created),
      panel: (
        <ProfileCampaignGrid
          slug={slug}
          kind="created"
          initial={created}
          name={profile.name}
          copy={copy.grid}
          locale={locale}
        />
      ),
    },
    {
      key: 'backed',
      label: copy.tabs.backed,
      ...knownTotal(backed),
      panel: (
        <ProfileCampaignGrid
          slug={slug}
          kind="backed"
          initial={backed}
          name={profile.name}
          copy={copy.grid}
          locale={locale}
        />
      ),
    },
    {
      key: 'about',
      label: copy.tabs.about,
      panel: <ProfileAbout profile={profile} locale={locale} copy={copy.about} />,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 py-10 sm:px-6 sm:py-14">
      {/*
        #143: Follow beside the name. `FollowControl` draws nothing for the owner, a sign-in
        link for a visitor, and the toggle for everybody else — the page itself stays
        cacheable because who is reading is decided in the browser.
      */}
      <ProfileHeader
        profile={profile}
        avatarAlt={fillPlaceholders(copy.avatarAlt, { name: profile.name })}
        actions={
          <FollowControl
            slug={profile.slug}
            name={profile.name}
            returnTo={pathOf(slug)}
            copy={followCopy}
          />
        }
      />

      {/*
        Above the tabs and therefore on every one of them, for the campaign page's reason: a
        reader who found it only under "created" would be a reader who had to go looking for
        it. It draws nothing at all for a creator with no late campaigns, which is most of them.
      */}
      {obligations !== null && (
        <CreatorObligationSummary obligations={obligations} name={profile.name} />
      )}

      <div className="mt-8">
        <ProfileTabs tabs={tabs} label={copy.tabsLabel} />
      </div>

      {/*
        #143: reporting the account, at the foot of the page and quiet, for the campaign
        page's reason — somebody who wants to report a person has read their profile. Hidden
        from the owner, who cannot report themselves.
      */}
      <ProfileReportControl
        slug={profile.slug}
        name={profile.name}
        returnTo={pathOf(slug)}
        copy={reportCopy}
        className="mt-16 border-t border-white/6 pt-6"
      />
    </div>
  );
}
