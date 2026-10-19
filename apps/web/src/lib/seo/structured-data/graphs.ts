import type { Locale } from '../../i18n/locale';
import {
  canonicalUrl,
  isPubliclyVisible,
  sitePath,
  type EnvSource,
  type PublicProjectPreview,
} from '../metadata';
import { localePath } from '../sitemap/localised';
import {
  breadcrumbNode,
  categoriesCrumb,
  collectionsCrumb,
  discoverCrumb,
  homeCrumb,
  type Crumb,
  type TrailCopy,
} from './breadcrumb';
import type { JsonLdNode } from './document';
import { faqPageNode, type FaqEntry } from './faq';
import { siteIdentityNodes } from './identity';
import { rewardProductNodes, type PublicRewardTier } from './product';

/**
 * ONE GRAPH PER PAGE, COMPOSED HERE.
 *
 * The modules beside this one each know how to describe one kind of thing and
 * deliberately know nothing about where it is mounted. This is the only file
 * that decides which page claims what, so the answer to "what does a campaign
 * page say about itself" is one function rather than a component that a later
 * page forgets to copy — the same rule `lib/seo/metadata.ts` states for `<meta>`
 * tags, applied to the machine-readable half of the same job.
 *
 * <h2>EVERY BUILDER TAKES THE ROUTE'S LOCALE SINCE #123</h2>
 *
 * Not decoration. A graph names URLs, and every URL on this platform now carries a language
 * segment; a node that named the un-prefixed one would be pointing a crawler at a 307. It
 * also names the page's language outright on `WebSite`, and it names the fixed breadcrumb
 * steps in words — both of which were English constants on all four languages until this
 * change. Structured data that contradicts the visible page is worse than none, because a
 * search engine that catches it once has grounds to discount the rest.
 */

/**
 * `/`, the home page — and therefore where the site's identity lives.
 *
 * **IT MOVED HERE FROM `/discover`, and that is the whole of the change #264 makes to this
 * file.** `identity.ts` explains the rule: Google reads site-level identity from the entry
 * page and asks for it on the home page or on one page describing the organisation, not on
 * every page. While there was no route at `/`, discovery was the entry page and the nodes
 * went there, with a comment saying so. There is one now.
 *
 * No breadcrumb. A trail on the page the trail starts from would be a single-item
 * `BreadcrumbList`, which `breadcrumbNode` refuses for the reason it gives — "you got here
 * from here" is not navigation.
 */
export function homePageGraph(input: {
  readonly locale: Locale;
  readonly env?: EnvSource;
}): readonly JsonLdNode[] {
  return [...siteIdentityNodes(input.locale, input.env ?? process.env)];
}

/**
 * `/discover`.
 *
 * THE IDENTITY NODES ARE NO LONGER HERE. They are on `/`, which exists as of #264, and two
 * `Organization` nodes for one organisation across a crawl is exactly what `identity.ts`
 * argues against. What is left is the trail, which is what this page actually has to say
 * about itself.
 */
export function discoverPageGraph(input: {
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
  readonly env?: EnvSource;
}): readonly JsonLdNode[] {
  const breadcrumb = breadcrumbNode(
    [homeCrumb(input.trailCopy), discoverCrumb(input.trailCopy)],
    input.locale,
    input.env ?? process.env,
  );

  return breadcrumb === null ? [] : [breadcrumb];
}

/**
 * A page that sits directly under the home page and describes the platform rather than a
 * campaign — `/about`, `/how-it-works`, `/pricing`, `/support`, `/trust-safety`, `/legal`.
 *
 * `discoverPageGraph`'s shape with the page named by the caller: Home, then the page. That is
 * the whole of what is true — these pages are reached from the header and the footer, which
 * are one step from home, and none of them is *about* an organisation, a product or an
 * article in the sense a richer type would claim. The identity nodes stay on `/`, for the
 * reason `identity.ts` gives.
 *
 * The crumb's name is the page's own title from the catalogue, so the trail says in the
 * page's language what the heading above it already says.
 */
export function sitePageGraph(input: {
  readonly crumb: Crumb;
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
  readonly env?: EnvSource;
}): readonly JsonLdNode[] {
  const breadcrumb = breadcrumbNode(
    [homeCrumb(input.trailCopy), input.crumb],
    input.locale,
    input.env ?? process.env,
  );
  return breadcrumb === null ? [] : [breadcrumb];
}

/**
 * A category or subcategory landing page — §4.13 WS-05.
 *
 * A TRAIL AND NOTHING ELSE. There is no schema.org type that describes "a list of
 * crowdfunding campaigns filed under Games" without overclaiming: `CollectionPage` says the
 * page is *about* a collection, `ItemList` invites a rich result this platform has no
 * eligibility for, and both would be markup emitted because it exists rather than because a
 * consumer acts on it. The trail is the one true statement — these pages genuinely do sit
 * under `/categories`, and a subcategory genuinely does sit under its category.
 *
 * This is the first trail on the platform with a real intermediate step. The campaign page's
 * is `Home → Discover → campaign` and `breadcrumb.ts` says why it stops there: a crumb
 * naming a category had nowhere to point, because `/discover?category=…` is a URL robots.txt
 * disallows. These routes are what that comment was waiting for.
 */
export function categoryPageGraph(input: {
  readonly trail: readonly Crumb[];
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
  readonly env?: EnvSource;
}): readonly JsonLdNode[] {
  const breadcrumb = breadcrumbNode(
    [homeCrumb(input.trailCopy), categoriesCrumb(input.trailCopy), ...input.trail],
    input.locale,
    input.env ?? process.env,
  );
  return breadcrumb === null ? [] : [breadcrumb];
}

/**
 * `/collections` — D-08's index.
 *
 * Home, then here: two steps, which is the fewest a trail may have and the reason
 * `breadcrumbNode` refuses one.
 */
export function collectionsIndexGraph(input: {
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
  readonly env?: EnvSource;
}): readonly JsonLdNode[] {
  const breadcrumb = breadcrumbNode(
    [homeCrumb(input.trailCopy), collectionsCrumb(input.trailCopy)],
    input.locale,
    input.env ?? process.env,
  );
  return breadcrumb === null ? [] : [breadcrumb];
}

/**
 * `/collections/{slug}` — a curated list's landing page.
 *
 * **A trail and nothing else, and the argument is `categoryPageGraph`'s applied harder.**
 * schema.org's `CollectionPage` says a page is *about* a collection, which is a claim about
 * the subject of a document rather than about a curated list of campaigns; `ItemList` invites
 * a rich result this platform has no eligibility for. Both would be markup emitted because it
 * exists rather than because a consumer acts on it. The trail is the one true statement:
 * these pages do sit under `/collections`, and that index is linked from every one of them.
 *
 * The name comes from the same response the page rendered its heading from, so the
 * machine-readable and human-readable halves cannot name two different collections — the rule
 * {@link projectPageGraph} states for a campaign.
 */
export function collectionPageGraph(input: {
  readonly title: string;
  readonly path: string;
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
  readonly env?: EnvSource;
}): readonly JsonLdNode[] {
  const breadcrumb = breadcrumbNode(
    [homeCrumb(input.trailCopy), collectionsCrumb(input.trailCopy), { name: input.title, path: input.path }],
    input.locale,
    input.env ?? process.env,
  );
  return breadcrumb === null ? [] : [breadcrumb];
}

export interface ProjectPageGraphInput {
  /** The public projection, or `null` when it could not be confirmed public. */
  readonly preview: PublicProjectPreview | null;
  /** The campaign page's route path — §10.2's `/projects/{creator}/{project}`. */
  readonly path: string;
  /** ISO 8601, or `null`. */
  readonly deadline: string | null;
  readonly tiers: readonly PublicRewardTier[];
  /** The pairs the page actually renders. See `faq.ts`. */
  readonly faqs: readonly FaqEntry[];
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
  readonly env?: EnvSource;
  /** Injected in tests; the wall clock otherwise. */
  readonly now?: Date;
}

/**
 * A campaign page's graph: the trail, its reward tiers, and its questions.
 *
 * **A campaign that could not be confirmed public produces an EMPTY graph** —
 * not a breadcrumb, not a title in a `ListItem`, nothing. That is the same lock
 * `projectPageMetadata` puts on the `<meta>` tags, in the same place in the same
 * order, and it is here for the same reason: the endpoint refuses a non-public
 * campaign, the reader refuses one that arrives anyway, and this refuses one
 * handed to it directly. A draft's title in a `BreadcrumbList` is a draft's title
 * in the HTML, whatever the `<title>` tag says.
 *
 * **The site identity is deliberately absent.** It is stated once, on the entry
 * page, and repeating it on every campaign would be two `Organization` nodes for
 * one organisation across the crawl.
 *
 * **MOUNTED SINCE #119**, on `app/projects/[id]/[projectSlug]/page.tsx`, which is
 * the server-rendered campaign page this was written ahead of. It is served the
 * same projection the page renders and the same tiers the page lists, so the
 * machine-readable and human-readable halves cannot describe two different
 * campaigns.
 *
 * **`faqs` CARRIES THE CAMPAIGN'S REAL QUESTIONS SINCE #283.** This paragraph
 * used to say the list was always empty because `GET /v1/projects/{id}/faqs` was
 * in §10.2 and unbuilt; it is built, and the campaign page reads it.
 *
 * That read is the one on that page which is NOT gated on the active tab, and
 * the reason is this function's own contract. `faqPageNode` takes "the pairs the
 * page actually renders", and the argument above — that the machine-readable and
 * human-readable halves cannot describe two different campaigns — is only kept
 * if the graph sees the same list on every address the campaign has. The graph
 * is emitted before the tab is chosen and every tab's canonical URL is the bare
 * path, so an `FAQPage` built only on `?tab=faq` would hang off the one address
 * no search engine indexes separately. `page.tsx` states this at its call site
 * as well, because it reads as a violation of its own "only the active tab is
 * fetched" rule and a later reader would otherwise correct it.
 *
 * A refused read still passes an empty list rather than a partial one, and
 * `faqPageNode` answers null for an empty list rather than emitting an `FAQPage`
 * with no questions in it — so a service that was restarting costs this graph a
 * node and never a wrong one.
 */
export function projectPageGraph(input: ProjectPageGraphInput): readonly JsonLdNode[] {
  const { preview } = input;
  if (preview === null || !isPubliclyVisible(preview.state)) return [];

  const env = input.env ?? process.env;
  /*
   * The localised address, so that the `Product` nodes' `url`, the `FAQPage`'s `@id` and the
   * last crumb all name the document this graph is embedded in rather than the 307 in front
   * of it — #123.
   */
  const campaignPath = sitePath(input.path, env);
  const campaignUrl = canonicalUrl(localePath(campaignPath, input.locale), env);
  /* The name of the campaign, as opposed to the address of one of its four documents. */
  const campaignId = canonicalUrl(campaignPath, env);

  const breadcrumb = breadcrumbNode(
    [homeCrumb(input.trailCopy), discoverCrumb(input.trailCopy), { name: preview.title, path: input.path }],
    input.locale,
    env,
  );
  const faq = faqPageNode(input.faqs, campaignUrl);

  return [
    ...(breadcrumb === null ? [] : [breadcrumb]),
    ...rewardProductNodes({
      campaignUrl,
      campaignId,
      campaignState: preview.state,
      deadline: input.deadline,
      tiers: input.tiers,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
    ...(faq === null ? [] : [faq]),
  ];
}
