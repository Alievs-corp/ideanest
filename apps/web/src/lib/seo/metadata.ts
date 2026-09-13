import type { Metadata } from 'next';
import { LOCALE_OG, type Locale, SUPPORTED_LOCALES } from '../i18n/locale';
import type { ProjectState } from '../projects/api';
import { absoluteUrl, siteUrl } from './sitemap/config';
import { languageAlternates, localePath } from './sitemap/localised';

/**
 * Every title, description, canonical URL, and social card this application
 * emits — built in one place, docs/architecture.md §4.3 and §4.4.
 *
 * ONE MODULE, ONE PLACE, the rule `lib/projects/api.ts` and `lib/discovery/api.ts`
 * already state. A page that writes its own `openGraph` block is a page that will
 * forget `og:site_name`, or spell the locale differently, or print the site name
 * into `og:title` where `og:site_name` already says it. Those mistakes are
 * invisible in review — nothing renders differently — and they are visible in
 * every shared link forever.
 *
 * There are exactly two shapes here, because there are exactly two kinds of page:
 *
 *   - `publicPageMetadata` — something a visitor with no session may read, and
 *     therefore something a crawler may index and an unfurler may preview.
 *   - `privatePageMetadata` — a checkout, a settings screen, an editor tab.
 *     `noindex, nofollow`, no canonical, and nothing to unfurl.
 *
 * Nothing here invents a fact about a campaign. Every string that describes one
 * comes from the campaign's own public projection, and a campaign whose state is
 * not public gets the private shape — see `isPubliclyVisible`.
 */

export const SITE_NAME = 'IdeaNest';

/**
 * The `<html lang>` of the **document**, which is the language of the public site.
 *
 * docs/architecture.md §21.1 makes Azerbaijani the primary language and English
 * phase 1. `next-intl` IS wired up now (#324) — what it covers is the account
 * area, which is already rendered per person, and not the public routes, which
 * are cached shared renders that a per-visitor language would turn into a render
 * each. `src/i18n/request.ts` argues that trade-off in full and names the work
 * that changes it (#123's locale-prefixed URLs, which are how a translated page
 * stays cached).
 *
 * So `lang="en"` remains the truth about this document rather than the plan. The
 * account area, when it renders in another language, declares that language on
 * its own wrapper — `lang` is valid on any element and overrides for its subtree,
 * which is the standard mechanism for a page with more than one language on it
 * and is what keeps a screen reader from pronouncing Russian with English
 * phonetics.
 *
 * IT LIVES HERE BECAUSE THE ROOT LAYOUT AND `og:locale` MUST NOT DISAGREE: a page
 * that announces `lang="en"` to a screen reader and `az_AZ` to Facebook is lying
 * to one of them, and there is one constant to change rather than two files to
 * remember. `lib/i18n/locale.ts` holds the per-language Open Graph spellings for
 * when a page can be served in more than one.
 */
/**
 * THE ONE DOCUMENT THAT STILL HAS NO LANGUAGE OF ITS OWN, and the reason it is a constant.
 *
 * Since #123 every page is served under a `[locale]` segment and declares that segment as
 * its `lang`, so this is no longer the site's language — it is the fallback for the single
 * frame rendered outside the localised tree. `app/global-error.tsx` replaces the whole
 * document after the root layout itself failed, which means the locale it would have read
 * is exactly the thing that did not survive. English is what it can honestly claim.
 *
 * Any other use is a bug. `publicPageMetadata` takes the route's own locale.
 */
export const SITE_LANGUAGE = 'en';

/** `og:locale` for that same fallback frame, in Open Graph's spelling. */
export const SITE_OG_LOCALE = 'en_US';

/**
 * `%s · IdeaNest`.
 *
 * A middot rather than a pipe or a dash: an em dash reads as punctuation inside
 * a sentence and a pipe is a shell character that some feed readers escape.
 */
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

/**
 * 160 characters.
 *
 * Not a specification — no search engine publishes one — but the width at which
 * a description stops being truncated in a result on a normal desktop viewport.
 * The point of the limit is that WE decide where the sentence ends rather than
 * letting a crawler cut it mid-word.
 */
export const DESCRIPTION_MAX_LENGTH = 160;

/** What the site says about itself when a page has said nothing more specific. */
export const SITE_DESCRIPTION =
  'Reward-based crowdfunding. Creators publish projects, backers pledge, and nobody is charged unless a project reaches its goal by its deadline.';

/** Just enough of `process.env` to be injectable in a test. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/* -------------------------------------------------------------------------
 * Where this application lives
 * ---------------------------------------------------------------------- */

/**
 * The base every absolute URL on the site is built from.
 *
 * DELEGATED TO `sitemap/config.ts` RATHER THAN READ AGAIN HERE, and that is the
 * whole point of this function existing at all. `robots.txt` and the sitemaps
 * write absolute URLs from `siteUrl()`; canonicals and `og:url` write them from
 * here. If the two read different variables — as they did when this module and
 * #122 were built in parallel, one on `IDEANEST_SITE_ORIGIN` and one on
 * `IDEANEST_SITE_URL` — then a deployment that sets only one of them ships a
 * sitemap and a canonical that name different hosts for the same page. A crawler
 * resolves that contradiction by trusting the canonical and discarding the
 * sitemap entry, silently, and nothing in CI would have said so. One variable,
 * `IDEANEST_SITE_URL`, read in one place.
 *
 * NOT A LITERAL, and not `NEXT_PUBLIC_`. Metadata is composed on the server and
 * nowhere else, so the browser has no use for this — the same reasoning
 * `next.config.mjs` gives for `IDEANEST_API_ORIGIN`. It is read at build time by
 * the statically rendered routes and per request by the dynamic ones, so a
 * deployment that changes it rebuilds.
 *
 * A CONFIGURED PATH IS KEPT rather than stripped, because `siteUrl()` keeps it
 * and the sitemap has to agree. A value that is not a URL at all throws: an
 * unset variable has a sensible development answer, but a misspelt one has no
 * answer, and a build that shipped `ideanest.az/discover` as a canonical would
 * be silently pointing every page at nothing.
 */
export function siteOrigin(env: EnvSource = process.env): URL {
  return new URL(`${siteUrl(env)}/`);
}

/**
 * What Next composes every relative metadata URL against.
 *
 * Set once, on the root layout. Without it Next guesses from the deployment's
 * environment and warns, and the guess is wrong behind a proxy — which is the
 * only arrangement this application is ever deployed in (`next.config.mjs`).
 */
export function metadataBase(env: EnvSource = process.env): URL {
  return siteOrigin(env);
}

/**
 * The one address that represents a page.
 *
 * Every query string is dropped, and that is the whole mechanism rather than an
 * oversight:
 *
 *   - **Discovery's filters live in the query string** (`lib/discovery/filters.ts`)
 *     and the feed they select is fetched and rendered in the browser. Every
 *     filter combination therefore has the SAME server-rendered document, so one
 *     canonical is not a simplification — it is the truth about what a crawler
 *     was served. `/discover?category=games` and `/discover` are one page.
 *   - **Tracking parameters** (`utm_*`, `fbclid`, `gclid`) name a campaign that
 *     sent a visitor, never a document. Leaving one in a canonical splits a page
 *     across as many URLs as there are newsletters that linked to it.
 *   - **Pagination parameters** name a position in a feed. The cursor is
 *     deliberately not in the URL at all, so a `?cursor=` or `?page=` reaching
 *     this function came from somebody else's scroll or a crawler's invention.
 *
 * A page whose *content* genuinely varies with its query string would need its
 * own rule here, and there is none in this application today. The alternative —
 * reading `searchParams` inside `generateMetadata` to emit a per-filter canonical
 * — was measured and rejected: it opts the route out of static rendering, and
 * `/discover` is the front door.
 *
 * Only the path survives, and it is rebuilt on our own origin, so a value that
 * arrived from a request cannot redirect a canonical to another host.
 */
export function canonicalUrl(path: string, env: EnvSource = process.env): string {
  return absoluteUrl(sitePath(path, env), siteUrl(env));
}

/**
 * The route path a value reduces to on our own origin: query string dropped, host discarded,
 * trailing slash removed.
 *
 * <p>Split out of {@link canonicalUrl} for #123, and the reason is a bug the split fixes.
 * A locale segment has to be inserted **after** this reduction and not before: prefixing
 * `https://elsewhere.example/steal` with `/en` produces `/enhttps://elsewhere.example/steal`,
 * which `new URL` then resolves as a relative path on our own origin — a crumb pointing at a
 * nonsense address instead of at the campaign. Callers that localise a path therefore reduce
 * it here first, and compose afterwards.
 */
export function sitePath(path: string, env: EnvSource = process.env): string {
  /*
   * `new URL(path, …)` is used to PARSE rather than to compose. It is what drops
   * the query string and what forces a value that arrived looking like
   * `https://elsewhere.example/x` down to its path, so a canonical cannot be
   * pointed at another host. The result is composed by `absoluteUrl`,
   * which is the same function the sitemap composes with — a base carrying a
   * path (`https://ideanest.az/az`) has to survive there exactly as it survives
   * here, and `new URL('/discover', base)` would have discarded it.
   */
  const { pathname } = new URL(path, `${siteUrl(env)}/`);

  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/* -------------------------------------------------------------------------
 * Descriptions
 * ---------------------------------------------------------------------- */

/**
 * `text`, shortened to at most `max` characters, cut between words.
 *
 * The ellipsis is inside the budget rather than added to it, so the result is
 * never longer than a caller allowed — a caller who asked for 160 and got 161 has
 * had the last character eaten by the crawler instead.
 *
 * Trailing punctuation is removed before the ellipsis because `Quba, …` reads as
 * a mistake and `Quba…` reads as a sentence that continues. Whitespace is
 * collapsed first: creator copy arrives with the newlines a textarea put in it,
 * and a newline inside a `<meta>` tag is a line break in somebody's search
 * result.
 *
 * A single unbroken word is cut mid-word, because the alternative is returning
 * nothing at all.
 */
export function truncateAtWord(text: string, max: number = DESCRIPTION_MAX_LENGTH): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean === '') return '';
  if (clean.length <= max) return clean;
  if (max <= 1) return '…';

  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;

  return `${kept.replace(/[\s,;:.!?—–-]+$/u, '')}…`;
}

/**
 * What a campaign says about itself in a search result and a shared link.
 *
 * THE CREATOR'S OWN SUMMARY, WHEN THERE IS ONE. `blurb` is the sentence they
 * wrote for exactly this purpose (docs/architecture.md §5.3), and a generated
 * description would be us paraphrasing somebody else's project — the same
 * mistake as machine-translating it (§21.1).
 *
 * When there is none, the fallback states what IdeaNest is and names the
 * campaign, and stops. It invents no adjective, no progress figure, and no
 * deadline: a description is cached by crawlers and unfurlers for days, and
 * "48 hours left" is false within two of them.
 */
export function projectSocialDescription(project: {
  readonly title: string;
  readonly blurb?: string | null;
}): string {
  const blurb = truncateAtWord(project.blurb ?? '');
  if (blurb !== '') return blurb;

  return truncateAtWord(
    `${project.title} — a crowdfunding campaign on ${SITE_NAME} that succeeds at 80% of its goal.`,
  );
}

/* -------------------------------------------------------------------------
 * Who may be seen — docs/architecture.md §6.1
 * ---------------------------------------------------------------------- */

/**
 * Whether a campaign in this state has a surface a visitor holding no session
 * can reach — and therefore whether anything about it may be printed into a
 * `<meta>` tag.
 *
 * `Record<ProjectState, boolean>` rather than a list of the public ones, so that
 * adding a seventeenth state to §6.1 is a COMPILE ERROR here rather than a state
 * that quietly defaults to one answer or the other. Which answer it would have
 * defaulted to decides whether the mistake is an unindexed campaign or a
 * published draft, and neither is a decision to leave to a fallthrough.
 *
 *   - `PRELAUNCH` and `SCHEDULED` are the pre-launch page, which is public by
 *     design — `GET /v1/projects/{id}/prelaunch` 404s for every other state.
 *   - `APPROVED` is not: a campaign that passed review but has not launched has
 *     no public address.
 *   - `SUSPENDED` and `CANCELED` are not, even though a page may still answer
 *     for them. Neither should be presented as a campaign to back, and a social
 *     card is exactly that presentation.
 *
 * WHETHER A PUBLIC PAGE SHOULD BE *INDEXED* IS A NARROWER QUESTION than whether
 * it may be described, and #122 owns it (`lib/seo/indexability.ts`). This
 * function is the floor both rest on: nothing that answers `false` here may be
 * indexed or described, whatever that module goes on to decide.
 */
const PUBLICLY_VISIBLE: Record<ProjectState, boolean> = {
  DRAFT: false,
  PRELAUNCH: true,
  SUBMITTED: false,
  CHANGES_REQUESTED: false,
  REJECTED: false,
  APPROVED: false,
  SCHEDULED: true,
  LIVE: true,
  CLOSING_WINDOW: true,
  EXTENDED: true,
  WITHDRAWN: true,
  SUSPENDED: false,
  CANCELED: false,
  SUCCESSFUL: true,
  UNSUCCESSFUL: true,
  COLLECTING: true,
  LATE_PLEDGE: true,
  FULFILLING: true,
  COMPLETED: true,
};

/** The sixteen states of docs/architecture.md §6.1, as values. */
export const PROJECT_STATES = Object.keys(PUBLICLY_VISIBLE) as readonly ProjectState[];

/** See `PUBLICLY_VISIBLE`. A state this build does not know is not public. */
export function isPubliclyVisible(state: string): boolean {
  return Object.hasOwn(PUBLICLY_VISIBLE, state) && PUBLICLY_VISIBLE[state as ProjectState];
}

/* -------------------------------------------------------------------------
 * Building the metadata
 * ---------------------------------------------------------------------- */

/** A social preview image, with the dimensions an unfurler needs up front. */
export interface SocialImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** What the image says, for a reader who cannot see it. */
  readonly alt: string;
}

export interface PublicPageInput {
  /**
   * The page's own title, WITHOUT the site name. `TITLE_TEMPLATE` adds it, and a
   * title that carries it as well reads `Discover · IdeaNest · IdeaNest`.
   */
  readonly title: string;
  readonly description: string;
  /**
   * The route's path WITHOUT a language on it — `/discover`, never `/az/discover`. Any query
   * string is dropped; see `canonicalUrl`. The locale below is what turns it into an address.
   */
  readonly path: string;
  /**
   * The language this render is in — the `[locale]` segment the route matched.
   *
   * IT IS REQUIRED, AND THAT IS THE POINT. Defaulting it to English would compile everywhere
   * and emit an English canonical on the Russian page, which is the one SEO defect that
   * cannot be seen by looking at the page: the document renders correctly in Russian and
   * quietly tells every crawler it is a duplicate of a different URL. A required field makes
   * the compiler name each of the ten call sites instead.
   */
  readonly locale: Locale;
  /**
   * An explicit preview image, or omitted to fall back to the nearest
   * `opengraph-image` file. See `publicPageMetadata`.
   */
  readonly image?: SocialImage | undefined;
  /** `website` unless the page is a piece of writing with an author and a date. */
  readonly type?: 'website' | 'article';
  readonly env?: EnvSource;
}

/**
 * The metadata for a page anybody may read.
 *
 * `openGraph.images` IS SET ONLY WHEN THERE IS AN IMAGE, and the difference
 * matters more than it looks. Next merges a file-based `opengraph-image` into a
 * segment's metadata only when that metadata has no `images` OWN PROPERTY
 * (`resolve-metadata.js`), so writing `images: undefined` is not "no opinion" —
 * it is "no image", and it would suppress the generated card and leave the page
 * with no preview at all.
 *
 * `og:title` and `twitter:title` carry the bare title for the same reason the
 * template exists: `og:site_name` already says IdeaNest, and a card that repeats
 * it has spent a third of its width on the word.
 */
export function publicPageMetadata(input: PublicPageInput): Metadata {
  const env = input.env ?? process.env;

  /*
   * The canonical is this page in THIS language, never the English one. A shared canonical
   * across the four would be a declaration that they are the same document, and a crawler
   * that believed it would index one and drop three.
   */
  const canonical = canonicalUrl(localePath(sitePath(input.path, env), input.locale), env);

  /*
   * The `hreflang` cluster, built by the same function the sitemap uses so the two documents
   * cannot disagree about what a page's alternates are. `localised.ts` explains why the map
   * names all four including this one.
   */
  const languages = languageAlternates(input.path, siteUrl(env));

  const title = input.title;
  const description = truncateAtWord(input.description);
  const images = input.image === undefined ? {} : { images: [{ ...input.image }] };

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      type: input.type ?? 'website',
      siteName: SITE_NAME,
      locale: LOCALE_OG[input.locale],
      /*
       * The other three, which is what tells an unfurler that translations exist. Open Graph
       * spells this as a repeated property rather than a list, and Next emits one tag per
       * array element.
       */
      alternateLocale: SUPPORTED_LOCALES.filter((other) => other !== input.locale).map(
        (other) => LOCALE_OG[other],
      ),
      url: canonical,
      title,
      description,
      ...images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...images,
    },
  };
}

/**
 * `/` — the one page whose title is not run through the template.
 *
 * `TITLE_TEMPLATE` is `%s · IdeaNest`, which is right for every page that has a subject and
 * wrong for the one whose subject IS the site: "IdeaNest · IdeaNest" in a browser tab, in a
 * bookmark, and in a search result. Next's metadata API has `title.absolute` for exactly
 * this, and this is the only caller of it.
 *
 * A SEPARATE FUNCTION RATHER THAN A FLAG ON `publicPageMetadata`. There is one page in the
 * application this applies to and there will be one page in the application this applies to;
 * a boolean parameter would be an invitation for a second caller to decide its title is
 * special too, and the site name would then be missing from a tab where somebody needed it.
 *
 * Everything else is `publicPageMetadata`'s: the canonical, the Open Graph block, the X card,
 * and the site-wide description, which is what the home page would have written for itself in
 * any case.
 */
export function homePageMetadata(locale: Locale, env: EnvSource = process.env): Metadata {
  const base = publicPageMetadata({
    title: `${SITE_NAME} — reward-based crowdfunding`,
    description: SITE_DESCRIPTION,
    path: '/',
    locale,
    env,
  });

  return {
    ...base,
    title: { absolute: `${SITE_NAME} — reward-based crowdfunding` },
  };
}

/**
 * The metadata for a page that is nobody's business but its reader's.
 *
 * `index: false, follow: false`, no canonical, and no Open Graph block at all.
 *
 * **`nofollow` as well as `noindex`, on every one of them.** The checkout, the
 * editor tabs, and the settings screens are shells around client boundaries
 * (`CheckoutView`, `BasicsPanel`, `SessionsPanel`): the markup a crawler
 * receives has no campaign links in it, because the data they link to is fetched
 * with a bearer token that a crawler does not have. `follow` on a page with
 * nothing to follow is a promise of crawl budget that is spent finding nothing.
 *
 * **`openGraph` and `twitter` are `null`, not absent.** Absent is not the same
 * thing: Next inherits a resolved `openGraph` down the segment tree, so a private
 * page that merely declined to set one would still carry the ROOT LAYOUT'S card —
 * a checkout link pasted into a chat would unfurl as a tidy IdeaNest preview and
 * imply the recipient could open it. `null` is how the metadata API says "and not
 * the one you inherited either".
 *
 * That was checked in the built HTML rather than assumed, and the check found one
 * exception worth knowing about: on a segment that has an `opengraph-image` FILE of
 * its own, Next merges that file's image back in afterwards and back-fills
 * `og:title` and `og:description` from the page's own title and description. The
 * only such segment is the campaign page, where `projectPageMetadata` reaches this
 * function for a campaign it could not confirm is public — and there the card that
 * comes back is the site's, which names no campaign. So the outcome is a generic
 * preview rather than none, and never a private one.
 */
export function privatePageMetadata(input: {
  readonly title: string;
  readonly description?: string;
}): Metadata {
  return {
    title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    robots: { index: false, follow: false },
    openGraph: null,
    twitter: null,
  };
}

/* -------------------------------------------------------------------------
 * A campaign
 * ---------------------------------------------------------------------- */

/**
 * The only fields of a campaign that metadata is allowed to know about.
 *
 * DELIBERATELY NARROW, and narrower than `PrelaunchPage`. `followerCount` is not
 * here, and neither is anything else that changes by the minute: a social card is
 * cached by every unfurler that renders it, so a number in one is a number that
 * will be wrong. `metadata-source.ts` produces this shape; nothing else may.
 */
export interface PublicProjectPreview {
  readonly id: string;
  readonly slug: string;
  readonly state: ProjectState;
  readonly title: string;
  readonly blurb: string | null;
  readonly coverImage: { readonly url: string; readonly width: number; readonly height: number } | null;
}

/**
 * Whether an image URL is one an unfurler can actually fetch.
 *
 * `http(s)` only. The cover URL is a value a creator typed
 * (`lib/projects/api.ts` — there is no media pipeline yet), so it reaches this
 * function unvalidated, and a `javascript:` or `data:` URL in an `og:image` is
 * at best a card that never renders.
 *
 * EXPORTED FOR `structured-data/product.ts`, which asks the same question about
 * a reward tier's image before naming it in a `Product` node. A second copy of
 * the check would be a second place for the allowed schemes to drift, and the
 * copy that drifts is always the one nobody remembers exists.
 */
export function isFetchableImageUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The metadata for a campaign's public page.
 *
 * A `null` preview — or one whose state is not public — produces the PRIVATE
 * shape and prints nothing whatsoever about the campaign, not even its
 * identifier in a canonical URL. That is the third lock on the same door: the
 * endpoint refuses a non-public campaign, `readPublicProjectPreview` refuses one
 * that arrives anyway, and this refuses one that is handed to it directly. The
 * cost of the belt and braces is a few lines; the cost of the leak is a
 * creator's unannounced project in somebody's search results.
 *
 * **A metadata fetch that could not confirm the campaign is public is treated as
 * not public.** A campaign that is briefly `noindex` because the service was
 * restarting is re-crawled and recovers by itself. A draft that was indexed does
 * not.
 *
 * What such a page actually serves was checked against a running build with the
 * service stopped: HTTP 200, `noindex, nofollow`, no canonical, the generic title
 * `Campaign`, and the site's own card — which names no campaign — from the segment's
 * image route. `privatePageMetadata` explains why the card survives at all.
 *
 * **The cover image wins over the generated card when there is one.** It is the
 * picture the creator chose for this campaign, §5.3 requires it to be at least
 * 1024×576, and an unfurler that has a real photograph should not be shown
 * typography instead. With no cover, `images` is left unset so that the
 * `opengraph-image` route renders the campaign's title onto the site's own card.
 */
export function projectPageMetadata(
  preview: PublicProjectPreview | null,
  path: string,
  locale: Locale,
  env: EnvSource = process.env,
): Metadata {
  if (preview === null || !isPubliclyVisible(preview.state)) {
    return privatePageMetadata({
      title: 'Campaign',
      description: `A crowdfunding campaign on ${SITE_NAME}.`,
    });
  }

  const cover = preview.coverImage;
  const image =
    cover !== null && isFetchableImageUrl(cover.url)
      ? { url: cover.url, width: cover.width, height: cover.height, alt: preview.title }
      : undefined;

  return publicPageMetadata({
    title: preview.title,
    description: projectSocialDescription(preview),
    path,
    locale,
    image,
    env,
  });
}

/* -------------------------------------------------------------------------
 * The root layout's defaults
 * ---------------------------------------------------------------------- */

/**
 * What every page inherits unless it says otherwise.
 *
 * NO CANONICAL HERE, deliberately. Next inherits `alternates` down the segment
 * tree, so a canonical on the root layout would become the canonical of every
 * page that forgot to set its own — every campaign on the site pointing at the
 * home page, which is the single most damaging thing this file could do. Each
 * public page sets its own through `publicPageMetadata`, and a page that sets
 * none has none, which is a recoverable omission rather than an active lie.
 *
 * `title.default` is the bare site name rather than the template applied to
 * something, because the template is what CHILDREN are composed with; a page
 * that sets no title of its own is the site itself.
 */
export function rootMetadata(locale: Locale, env: EnvSource = process.env): Metadata {
  return {
    metadataBase: metadataBase(env),
    applicationName: SITE_NAME,
    title: {
      default: SITE_NAME,
      template: TITLE_TEMPLATE,
    },
    description: SITE_DESCRIPTION,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      /*
       * The layout's default, inherited by any page that sets no Open Graph block of its
       * own — every private route, in other words. It follows the route's language rather
       * than naming English on a Russian settings screen.
       */
      locale: LOCALE_OG[locale],
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
    twitter: {
      card: 'summary_large_image',
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
    formatDetection: {
      // A campaign's goal is a number in AZN, not a phone number to be linked.
      telephone: false,
    },
  };
}
