import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CampaignComments } from '../../../../../components/project/CampaignComments';
import { CampaignFaqs } from '../../../../../components/project/CampaignFaqs';
import { CampaignOutcomeNotice } from '../../../../../components/project/CampaignOutcomeNotice';
import { CampaignRewards } from '../../../../../components/project/CampaignRewards';
import { CampaignStory } from '../../../../../components/project/CampaignStory';
import { CampaignSummary } from '../../../../../components/project/CampaignSummary';
import { CampaignTabs } from '../../../../../components/project/CampaignTabs';
import { CampaignTrustBlock } from '../../../../../components/project/CampaignTrustBlock';
import { CampaignUpdates } from '../../../../../components/project/CampaignUpdates';
import { UpdateObligationNotice } from '../../../../../components/project/UpdateObligationNotice';
import { CreatorPanel } from '../../../../../components/project/CreatorPanel';
import { ReportControl } from '../../../../../components/moderation/ReportControl';
import { fetchUpdateObligation } from '../../../../../lib/obligations/server';
import { StructuredData } from '../../../../../components/seo/StructuredData';
import { fetchCommentThreads } from '../../../../../lib/community/comments';
import { fetchProjectFaqs } from '../../../../../lib/community/faqs';
import { fetchProjectUpdates } from '../../../../../lib/community/updates';
import { fetchCampaignPage, fetchPublicRewards } from '../../../../../lib/api/server';
import {
  CREATOR_PROJECT_LIMIT,
  fetchCreatorProjects,
  fetchPublicProfile,
} from '../../../../../lib/projects/creatorProfile';
import type { CampaignPage } from '../../../../../lib/projects/publicPage';
import { previewOf, readCampaignPage, tiersOf } from '../../../../../lib/projects/publicPage';
import {
  CAMPAIGN_CURSOR_PARAM,
  CAMPAIGN_TAB_PARAM,
  CAMPAIGN_THREAD_PARAM,
  campaignCursorFrom,
  campaignTabHref,
  campaignTabFrom,
} from '../../../../../lib/projects/tabs';
import { projectPageRobots } from '../../../../../lib/seo/indexability';
import { projectPageMetadata } from '../../../../../lib/seo/metadata';
import { REALTIME_ORIGIN_VARIABLE } from '../../../../../lib/realtime/updates';
import { projectPageGraph } from '../../../../../lib/seo/structured-data/graphs';
import { graphContext, reportControlCopy } from '../../../../../lib/i18n/shell-copy.server';
import { localeOrDefault } from '../../../../../lib/i18n/locale';

/**
 * The public campaign page — §4.4, at §10.2's `/projects/{creatorSlug}/{projectSlug}`.
 *
 * <h2>#119, and what "server-rendered" has to mean here</h2>
 *
 * The requirement is that the content is in the initial HTML rather than assembled by the
 * client. This page fetches the campaign, its reward tiers and whichever tab was asked for on
 * the server and renders them; there is no loading state, because there is nothing to load. A
 * crawler, a link unfurler and a reader on a slow connection are all served the same complete
 * document — including the comments, if that is the address they were given.
 *
 * That is also why the endpoint behind it carries the story: a page whose body arrived in a
 * second request would satisfy the letter of "server-rendered" and fail the thing it is for.
 *
 * <h2>The client boundaries beneath this route, and why each one is here</h2>
 *
 * The rule this page holds itself to is not "no client components" — it is that <em>no
 * content</em> waits for the browser. Every island below renders the server's answer first
 * and then adds something the server could not know:
 *
 * <ul>
 *   <li><strong>`LiveFunding`</strong> (#91) — starts from the rendered figures and adds
 *       §12.1's deltas.
 *   <li><strong>`CampaignCountdown` and `ViewerInstant`</strong> (#281) — the current time and
 *       the reader's time zone. Neither reaches a server render, and a cookie carrying the
 *       zone would make this page uncacheable, which is the arrangement §4.4 exists to
 *       protect.
 *   <li><strong>`CampaignActions`</strong> (#281) — save, share and the launch reminder. Two
 *       writes and a clipboard.
 *   <li><strong>`CommentComposer` and `CommentControls`</strong> (#285) — the three comment
 *       writes, all of which need a bearer token.
 *   <li><strong>`ReportControl`</strong> (#286) — §4.9's C-06 and C-07.
 * </ul>
 *
 * <strong>Not one of them imports `@ideanest/ui/motion`.</strong> That entry point is 116 kB
 * of animation runtime and the note below on entry animations is the whole argument; the
 * dialog entries on this page are CSS keyframes in `app/globals.css` for the same reason.
 *
 * <h2>The tabs are addresses, not state</h2>
 *
 * `?tab=comments` rather than a `useState` or a route per tab, and
 * `lib/projects/tabs.ts` argues all three options and the two it rejected. The short version:
 * local state makes the Comments tab unlinkable and invisible to a crawler, a route per tab
 * multiplies one canonical URL into six and adds five entries to a budgets file CI fails on
 * in both directions, and a query parameter costs a navigation that each tab's own separate
 * read was always going to need.
 *
 * <strong>Only the active tab is fetched, with exactly one exception.</strong> The updates,
 * the comments and the creator's profile are read only when their tab is the one being
 * rendered. Fetching all of them to render one would be several times the service load per
 * crawl for content nobody asked for, on the route whose largest contentful paint is the
 * subject of #119.
 *
 * <strong>The FAQ is the exception, and it is read on every tab.</strong> Not for the tab —
 * for the structured data. `faqPageNode` is documented as taking "the pairs the page actually
 * renders", and `projectPageGraph`'s whole argument is that the machine-readable and the
 * human-readable halves of this page cannot describe two different campaigns. The graph is
 * emitted before the tab is chosen and the canonical URL of every tab is the bare path, so an
 * `FAQPage` node built only on `?tab=faq` would hang off the one address no search engine
 * indexes separately — which is a node that exists for nobody.
 *
 * So this one read is paid on every render: one small, unpaged, minute-cached body against a
 * graph that is true on every address the campaign has. <strong>Do not "fix" this by moving
 * it inside the tab</strong> — it would silently empty the `FAQPage` node on four tabs out of
 * five. The tab is handed the same list rather than reading it again.
 *
 * <h2>Why the folder is `[id]/[projectSlug]` when the first segment is a creator's slug</h2>
 *
 * Next allows exactly one slug name per dynamic level, and `app/projects/[id]/` already
 * exists — it carries `/edit`, `/back` and `/prelaunch`, where the segment really is a
 * campaign identifier. A sibling `[creatorSlug]` is a build error, so the public page reuses
 * the name and binds it to `creatorSlug` below. **The URL is correct and the folder name is
 * a framework artefact**; renaming it belongs with whatever moves the creator's own routes
 * out from under `/projects`.
 *
 * There is no ambiguity at request time. `/{id}/edit` and its siblings are literal-segment
 * patterns, which Spring's counterpart and Next's router both prefer over two variables, so
 * `/projects/{uuid}/edit` never reaches this page.
 *
 * <h2>404, and the three things it covers</h2>
 *
 * A URL that resolves to nothing, a campaign whose state has no public page, and a service
 * that refused the read are one answer. `PublicProjects` argues it on the server side and
 * `readCampaignPage` re-checks the state here — the second lock on the same door.
 * `notFound()` renders the 404 route with a 404 status, which is what a crawler needs in
 * order to stop asking.
 *
 * <strong>A tab is never a 404.</strong> `?tab=nonsense` renders the campaign, because a
 * mistyped query parameter must not be able to take a real campaign off the internet;
 * `campaignTabFrom` states that rule and the canonical URL stays the bare path regardless, so
 * no search engine is told the mistyped address is a page of its own.
 */

/** The route's own path, for the canonical URL and the structured data's trail. */
function pathOf(creatorSlug: string, projectSlug: string): string {
  return `/projects/${encodeURIComponent(creatorSlug)}/${encodeURIComponent(projectSlug)}`;
}

/**
 * The query string this page reads, as Next hands it over.
 *
 * Written out rather than taken as `Record<string, string>`, because a repeated parameter
 * arrives as an array and a reader that assumed a string would silently take the wrong branch
 * on `?tab=a&tab=b`.
 */
type CampaignSearchParams = Record<string, string | string[] | undefined>;

/**
 * The title, description, canonical and social card of one campaign.
 *
 * **A second fetch is not made here.** Next deduplicates `fetch` within a render, and both
 * calls go through the same `next: { revalidate }` cache entry, so `generateMetadata` and
 * the component below read one response. That is the arrangement that makes it safe for the
 * `<head>` and the `<body>` to describe the campaign from the same projection rather than
 * from two reads a second apart.
 *
 * **The tab is deliberately not read here.** Every tab describes one campaign, so the title,
 * the description and above all the canonical are the campaign's rather than the tab's — a
 * canonical that varied by `?tab=` would tell a search engine this page is four pages whose
 * content is mostly identical, which is the duplicate-content problem the query parameter was
 * chosen to avoid in the first place.
 *
 * A campaign that cannot be confirmed public gets `noindex`, no canonical, and nothing said
 * about it — `projectPageMetadata` explains why the failure mode has to be a card that says
 * nothing rather than one that says something private.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string; projectSlug: string }>;
}): Promise<Metadata> {
  const { locale, id: creatorSlug, projectSlug } = await params;
  const campaign = readCampaignPage(await fetchCampaignPage(creatorSlug, projectSlug), creatorSlug);

  const metadata = projectPageMetadata(
    campaign === null ? null : previewOf(campaign),
    pathOf(creatorSlug, projectSlug),
    localeOrDefault(locale),
  );
  if (campaign === null) return metadata;

  /*
   * #122's decision, applied to the page it was written for. `projectPageRobots` says of
   * itself that nothing rendered it yet because this page did not exist; it does now.
   *
   * Two of the nine states this page serves are public and deliberately not indexed, and
   * they are not the same two `projectPageMetadata` withholds a card from. `CANCELED` is a
   * campaign the creator withdrew: its backers keep the link and a permanent search result
   * for it would outrank the live campaigns beside it. `PRELAUNCH` is an unmoderated teaser
   * at a URL that stops existing the moment the campaign opens.
   *
   * `follow` stays true for both. Such a page still links to its creator, its category and
   * the feed, and every one of those is indexable — `nofollow` would throw away the one
   * useful thing an unindexed page does. The sitemap filters on the same predicate, so a
   * page and its entry cannot disagree.
   */
  return { ...metadata, robots: projectPageRobots(campaign.state) };
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; projectSlug: string }>;
  searchParams: Promise<CampaignSearchParams>;
}) {
  const { id: creatorSlug, projectSlug } = await params;
  const query = await searchParams;

  const campaign = readCampaignPage(await fetchCampaignPage(creatorSlug, projectSlug), creatorSlug);
  if (campaign === null) notFound();

  const path = pathOf(creatorSlug, projectSlug);
  const tab = campaignTabFrom(query[CAMPAIGN_TAB_PARAM]);
  const cursor = campaignCursorFrom(query[CAMPAIGN_CURSOR_PARAM]);
  const thread = campaignCursorFrom(query[CAMPAIGN_THREAD_PARAM]);

  /*
   * The tiers are fetched only once the campaign is known to be public. Asking for them
   * first would put a request on the service for every crawl of a URL that does not exist —
   * and would do it with an identifier this page does not have until the first read answers.
   *
   * They are fetched on every tab rather than only on the Campaign one, because the tier list
   * is the column beside the tabs rather than a tab of its own: a reader deciding what to
   * pledge keeps it in view while they read the comments. `lib/projects/tabs.ts` records that
   * decision and why Rewards is not in the tab list.
   */
  const tiers = tiersOf(await fetchPublicRewards(campaign.id));

  /*
   * Read on every tab, deliberately — see the header comment. It feeds the `FAQPage` node in
   * the graph below, which is emitted on every address this campaign has, and it is handed to
   * the FAQ tab rather than read a second time there.
   *
   * After the public check, like the tiers and for the same reason: asking for a campaign's
   * questions before the campaign is known to be public would put a request on the service
   * for every crawl of a URL that does not exist, with an identifier this page does not have
   * until the first read answers.
   *
   * `null` is a refused read. The graph is given an empty list for it rather than a partial
   * one, and the tab is given the `null` so it can say the service failed rather than that
   * the creator has answered nothing.
   */
  /*
   * §5.5's clock joins the FAQ read rather than following it — #437. Both are keyed on the
   * identifier the first read answered with, both are cached for a minute under this campaign's
   * tag, and doing them in sequence would be a second serial round trip on the route whose
   * largest contentful paint is the subject of #119.
   *
   * `null` from the obligation covers two situations and the page treats them alike,
   * deliberately: a campaign with no clock answers 204, and a read that failed answers nothing.
   * Both mean "there is nothing to say about this campaign's updates", and telling a reader an
   * obligation could not be loaded would be inventing an obligation to apologise for.
   * `lib/obligations/server.ts` has the argument.
   */
  const [faqs, obligation] = await Promise.all([
    fetchProjectFaqs(campaign.id),
    fetchUpdateObligation(campaign.id),
  ]);

  return (
    /*
      A `<div>` and not a `<main>` since #343. `app/projects/[id]/[projectSlug]/layout.tsx`
      puts this page inside `SiteShell`, which owns the only `<main>` on the document and is
      the skip link's target; a second one would make "jump to main" a question with two
      answers. The column width and the padding stay here, because the shell deliberately
      sets neither — every page inside it draws its own measure.
    */
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-6">
      {/*
        The structured data was written before this page existed — `projectPageGraph` says
        so — and mounting it is the last step of #121. It is emitted outside every other
        element so that it is in the first bytes a crawler reads rather than after a
        photograph.

        `faqs` IS NO LONGER EMPTY. `faqPageNode` was written ahead of the endpoint and said
        so; #283 built `GET /v1/projects/{id}/faqs`, so the node now describes the campaign's
        real questions rather than being withheld. The header comment above explains why that
        read is the one that is NOT gated on the active tab.

        A refused read passes an empty list, not a wrong one. `faqPageNode` answers null for
        an empty list rather than emitting an `FAQPage` with no questions in it, so a service
        that was restarting costs this page a node and never an untrue one — the same
        distinction the tab itself draws between "could not be loaded" and "has nothing
        here".
      */}
      <StructuredData
        nodes={projectPageGraph({
          preview: previewOf(campaign),
          path,
          deadline: campaign.deadline,
          tiers,
          faqs: faqs ?? [],
          ...(await graphContext()),
        })}
      />

      {/*
        NO ENTRY ANIMATION, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.

        docs/motion-system.md §5 gives the project page a "moderate" budget — section
        headings, counters, a sticky call to action — so a `FadeUp` on this header would be
        within it. It is not here because of what it costs on this particular page.

        `FadeUp` reaches `motion/react`, which `@ideanest/ui/motion` measures at 116 kB
        uncompressed and which is why that entry point exists at all. Reaching it from a
        Server Component also requires a client wrapper, so the whole header would become a
        client boundary. Paying both on the page whose largest contentful paint is the
        entire subject of #119 — to fade one heading in once — is the trade that issue
        exists to refuse.

        THE TABS DID NOT CHANGE THIS. #282, #284 and #285 added four client islands to this
        route, and none of them is an animation runtime: the largest is a textarea and a
        submit button. The budget was not spent, it was declined again — an entry animation on
        a comment list is an animation on the one surface where somebody is waiting for an
        answer to a question they asked.

        It becomes worth revisiting when the page has something else on it that animates,
        which §5's own list says it will: a counter on the funding figure and the sticky
        call to action that arrives with the pledge flow. At that point the runtime is being
        paid for anyway.
      */}
      {/*
        §12.1's live counter is opt-in, and read here so the page decides once. Unset — the
        default — means no socket is opened and this page behaves exactly as it did before
        #91. `lib/realtime/updates.ts` explains why it cannot simply use the `/v1` rewrite
        every other browser call goes through.
      */}
      <CampaignSummary
        campaign={campaign}
        realtimeOrigin={process.env[REALTIME_ORIGIN_VARIABLE]}
        path={path}
      />

      {/*
        §4.4's trust block, above the tabs and therefore on every one of them. It is fixed copy
        "on every project" and it is the paragraph that says nobody is charged unless the
        campaign funds — putting it inside a tab would mean a reader could reach the comments,
        the creator and the updates without ever being told the rule the whole platform runs
        on.
      */}
      <CampaignTrustBlock campaign={campaign} />

      {/*
        §5.5's monthly update, beside the trust block and above the tabs, for the trust block's
        own reason: it belongs to the campaign rather than to one of its tabs, and a reader who
        found it only under "updates" would be a reader who had to go looking for the fact that
        there are none.

        It draws nothing at all for a campaign with no clock, or one whose creator is up to
        date — see `UpdateObligationNotice` on why a panel that appeared only when something was
        wrong would be a badge by its presence.
      */}
      {obligation !== null && <UpdateObligationNotice obligation={obligation} />}

      <CampaignTabs active={tab} path={path} />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-8">
          {tab === 'campaign' && (
            <>
              {campaign.outcome !== null && <CampaignOutcomeNotice campaign={campaign} />}

              {campaign.story !== null && (
                <CampaignStory story={campaign.story} title={campaign.title} />
              )}

              {campaign.risks !== null && (
                /*
                  §5.5 makes the risks section a creator obligation and §5.3 requires two hundred
                  characters of it before a campaign may be submitted. It is plain text rather
                  than a document — there is one column behind it — and it is on the Campaign tab
                  beside the story rather than behind a tab of its own because a backer deciding
                  whether to commit money is exactly who it was written for.
                */
                <section aria-labelledby="campaign-risks" className="flex flex-col gap-3">
                  <h2
                    id="campaign-risks"
                    className="text-xl font-medium tracking-[-0.02em] text-white"
                  >
                    Risks and challenges
                  </h2>
                  <p className="max-w-[68ch] wrap-anywhere text-[1.0625rem] leading-[1.75] whitespace-pre-line text-reading">
                    {campaign.risks}
                  </p>
                </section>
              )}
            </>
          )}

          {tab === 'creator' && <CreatorTab campaign={campaign} />}

          {tab === 'faq' && <CampaignFaqs faqs={faqs} />}

          {tab === 'updates' && <UpdatesTab campaign={campaign} path={path} cursor={cursor} />}

          {tab === 'comments' && (
            <CommentsTab campaign={campaign} path={path} cursor={cursor} thread={thread} />
          )}
        </div>

        <CampaignRewards
          tiers={tiers}
          projectId={campaign.id}
          state={campaign.state}
          deadline={campaign.deadline}
        />
      </div>

      {/*
        §4.9's C-06, mounted by #286.

        AT THE FOOT OF THE PAGE, AND QUIET. A Report control beside the pledge button would
        put "something is wrong here" next to "give this person money" on every campaign,
        including the honest ones. Somebody who wants to report a campaign has read it, so
        the end of the page is where they are; `--text-tertiary` at 4.9:1 is legible without
        competing (docs/ui-kit.md §9.1).

        THE CREATOR'S ACCOUNT STILL CANNOT BE REPORTED FROM HERE, and #282 did not change it.
        `POST /v1/users/{id}/report` takes an identifier and both
        `GET /v1/projects/{creatorSlug}/{projectSlug}` and `GET /v1/users/{slug}` are addressed
        by slug and answer with one — neither carries the account id the report endpoint needs.
        The surface that has one is the public profile itself (#274). `ReportControl` already
        takes an account target; it gains an entry point when that page can supply an id.

        `ReportControl` writes §4.11's dialog entry as a CSS keyframe rather than importing
        `@ideanest/ui/motion`, for the reason the header comment above gives: 116 kB of
        animation runtime is not spent on the page #119 exists to keep fast.
      */}
      <div className="mt-16 border-t border-white/6 pt-6">
        <ReportControl
          target={{ kind: 'campaign', id: campaign.id }}
          name={campaign.title}
          returnTo={path}
          copy={await reportControlCopy()}
        />
      </div>
    </div>
  );
}

/**
 * §4.4's Creator tab — #282.
 *
 * Two reads, made together rather than in sequence: the profile and the creator's other
 * campaigns are independent, and awaiting them one after the other would add a round trip to
 * the tab for nothing. `Promise.all` is safe here because both readers answer `null` rather
 * than throwing — `lib/projects/creatorProfile.ts` states that — so one refusal cannot reject
 * the pair and take the page to an error route.
 *
 * The campaign being read is dropped from the list here rather than in the reader, because
 * "what has this person made" is the endpoint's question and "which of those am I already
 * looking at" is this page's.
 */
async function CreatorTab({
  campaign,
}: {
  readonly campaign: CampaignPage;
}) {
  const [profile, projects] = await Promise.all([
    fetchPublicProfile(campaign.creator.slug),
    fetchCreatorProjects(campaign.creator.slug),
  ]);

  /*
   * One extra row is asked for so that removing this campaign cannot leave the list a row
   * short of what it promised; the surplus is trimmed after the filter rather than before it.
   */
  const others = (projects?.projects ?? [])
    .filter((project) => project.id !== campaign.id)
    .slice(0, CREATOR_PROJECT_LIMIT);

  return <CreatorPanel campaign={campaign} profile={profile} projects={others} />;
}

/*
 * §4.4's FAQ tab — #283 — has no async component of its own, and that is the visible
 * consequence of the exception stated at the top of this file: its read is made in the page
 * body so that the structured data and the tab are given the same list. `CampaignFaqs` is
 * therefore rendered directly above.
 *
 * The read is unpaged, because §4.4 caps a campaign's list at fifty entries server-side and
 * publishes no cursor — so there is no cursor to carry and no "older questions" link to
 * build. The cap is what makes the absent cursor honest: if fifty stops being enough the
 * answer is a cursor, never a bigger cap, because the failure mode of the alternative is
 * silent truncation.
 */

/** §4.4's Updates tab — #284. */
async function UpdatesTab({
  campaign,
  path,
  cursor,
}: {
  readonly campaign: CampaignPage;
  readonly path: string;
  readonly cursor: string | null;
}) {
  /*
   * The cursor arrives as the string the URL carried and goes back to the service as a
   * number, because that is what an update cursor is — the update number to read back from.
   * A value that is not a number is treated as no cursor at all rather than as a refusal: it
   * is a mistyped or truncated link, and the first page of updates is a better answer to that
   * than an error.
   */
  const from = cursor === null ? null : Number.parseInt(cursor, 10);
  const page = await fetchProjectUpdates(
    campaign.id,
    from === null || Number.isNaN(from) ? null : from,
  );

  const olderHref =
    page?.nextCursor == null
      ? null
      : campaignTabHref(path, 'updates', { cursor: String(page.nextCursor) });

  return <CampaignUpdates page={page} olderHref={olderHref} paged={cursor !== null} />;
}

/** §4.4's Comments tab — #285. */
async function CommentsTab({
  campaign,
  path,
  cursor,
  thread,
}: {
  readonly campaign: CampaignPage;
  readonly path: string;
  readonly cursor: string | null;
  readonly thread: string | null;
}) {
  const page = await fetchCommentThreads(campaign.id, { cursor, thread });

  const olderHref =
    page?.nextCursor == null
      ? null
      : campaignTabHref(path, 'comments', { cursor: page.nextCursor, thread });

  /*
   * "Show more replies" for each conversation that has some, as an address rather than as a
   * press handled in the browser. `CAMPAIGN_THREAD_PARAM` argues why: the alternative is a
   * client component per conversation on this route, and a reply nobody could link to.
   *
   * Built here rather than in the component, because the component would have to know how a
   * campaign URL is spelled — and `pathOf` above is deliberately the only thing that does.
   */
  const threadHrefs: Record<string, string> = {};
  for (const conversation of page?.threads ?? []) {
    if (conversation.nextReplyCursor !== null) {
      threadHrefs[conversation.root.id] = campaignTabHref(path, 'comments', {
        thread: conversation.root.id,
      });
    }
  }

  return (
    <CampaignComments
      page={page}
      projectId={campaign.id}
      campaignTitle={campaign.title}
      returnTo={path}
      olderHref={olderHref}
      singleThread={thread !== null}
      allThreadsHref={campaignTabHref(path, 'comments')}
      threadHrefs={threadHrefs}
    />
  );
}
