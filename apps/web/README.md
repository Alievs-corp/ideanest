# @ideanest/web

The Next.js application. App Router, React 19, Tailwind 4, and the primitives
from `@ideanest/ui`.

`@ideanest/ui` has two entry points and the choice is a performance decision, not
a taste one: the root is free, and `@ideanest/ui/motion` pulls in 116 kB of
animation runtime. Import `FadeUp`, `Modal`, `Drawer`, `Popover`, `Tooltip` and
the toast pair from `/motion`; import everything else from the root. A route that
never imports `/motion` never ships `motion` — which is how the checkout stopped
paying for an animation library it does not use. `packages/ui/README.md` has the
measurement.

## Running it

```bash
pnpm --filter @ideanest/web dev        # http://localhost:3000
```

The service has to be running too, because every `/v1` request is proxied to it:

```bash
cd apps/api && ./gradlew bootRun       # http://localhost:8080
```

| Variable | Default | Meaning |
|---|---|---|
| `IDEANEST_API_ORIGIN` | `http://localhost:8080` | Where `/v1/*` is proxied. Read at build time on the server only — the browser never learns it. The sitemap also reads the service directly through it |
| `IDEANEST_SITE_URL` | `http://localhost:3000` | This application's public origin. **Must be set in any deployed environment** — every `robots.txt` entry, sitemap URL, canonical URL, `og:url`, and absolute social-image URL is written against it. Server-only, and read at build time by the statically rendered pages, so changing it means rebuilding. A value that is set but is not an absolute `http(s)` URL is refused rather than fallen back on |
| `IDEANEST_REVALIDATE_SECRET` | unset | The shared secret the service presents to `POST /api/cache/revalidate`. **Unset refuses every call**, rather than allowing them: an endpoint that evicts cached pages by name and asks for no proof is a request anybody can send in a loop to turn every cached render into an origin fetch. Same value as the service's `CACHE_REVALIDATE_SECRET`. See [Caching and revalidation](#caching-and-revalidation) |
| `NEXT_PUBLIC_IDEANEST_RUM_SAMPLE_RATE` | `1` | Fraction of sessions whose Core Web Vitals are reported. `0` collects nothing at all. `NEXT_PUBLIC_`, so it is inlined at build time and changing it means rebuilding. See [Real user monitoring](#real-user-monitoring) |
| `IDEANEST_RUM_LOCAL_SINK` | on outside production | The in-memory buffer behind `GET /api/rum`. `next start` runs as production on a laptop too, so set `true` to keep the table there |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | unset | Google's OAuth client identifier (§4.1 A-04). **Unset means the Google button is not rendered at all** — the service answers 501 for a provider it has no configuration for, and a button that always fails is worst of all on the sign-in screen. A client identifier is public by construction; the client *secret* is the service's and neither of these flows uses one |
| `NEXT_PUBLIC_APPLE_CLIENT_ID` | unset | Apple's services identifier (§4.1 A-05), on the same terms. The popup flow still needs a redirect URI registered with Apple; this application sends its own `/sign-in` |

### Why the API is proxied rather than called directly

The refresh cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/v1/auth`. A
browser will not attach it to a request aimed at a different origin, which is
the entire point of the setting, and the service declares no CORS policy so a
cross-origin call would not survive its preflight either. Routing `/v1` through
this application is what makes the pair same-origin, and therefore what makes
the browser half of the auth flow work at all.

## Scripts

| Script | What it does |
|---|---|
| `dev` | Development server |
| `build` / `start` | Production build and server |
| `typecheck` | `tsc --noEmit` — runs in CI |
| `test` | Vitest, behaviour and accessibility — runs in CI |

## Routes

| Route | Shell | Issue |
|---|---|---|
| `/` | Site | **Public.** The home page: featured campaigns, what is ending soon, and the categories (#264) |
| `/discover` | Site | **Public.** The filter rail, sort, chips, and the cursor-paginated feed (#45) |
| `/search` | Site | **Public**, `noindex`. WS-06's dedicated results route, behind the header's search field (#262) |
| `/categories` | Site | **Public.** Every category and subcategory, and the crawl path to their pages (#265) |
| `/categories/[category]` | Site | **Public.** A category's indexable landing page (#265) |
| `/categories/[category]/[subcategory]` | Site | **Public.** A subcategory's, resolved inside its own parent (#265) |
| `/collections` | Site | **Public.** D-08's index: staff selections, themed collections and open calls, and the crawl path to their pages (#266) |
| `/collections/[slug]` | Site | **Public.** A collection's landing page — its campaigns in the curator's order, cursor-paginated. 404 for one that is unpublished or outside its window (#266) |
| `/maintenance` | Site | **Public**, `noindex`. WS-09's planned-outage page. Nothing routes to it — see below (#263) |
| `/sign-in` | Minimal | **Public**, `noindex`. Email and password, with the suspension and the rate limit surfaced (#268) |
| `/register` | Minimal | **Public**, `noindex`. Account creation and the "check your email" state (#269) |
| `/verify-email` | Minimal | **Public**, `noindex`. Where the verification link lands, and the expired-token path (#270) |
| `/reset-password` | Minimal | **Public**, `noindex`. §4.1 A-06: asks for a link. Says the same thing whether or not the address has an account (#271) |
| `/reset-password/confirm` | Minimal | **Public**, `noindex`. Where the reset link lands. The hour is stated before the fields, not only after the refusal (#271) |
| `/confirm-email-change` | Minimal | **Public**, `noindex`. §4.1 A-12: where the link sent to the *new* address lands (#277) |
| `/about` | Site | **Public.** WS-07: what the platform is, all-or-nothing, and what it costs (#292) |
| `/how-it-works` | Site | **Public.** WS-07: backing a campaign, running one, and what happens between a pledge and a parcel (#292) |
| `/trust-safety` | Site | **Public.** WS-07: what is reviewed, how to report, and what happens to money and data (#292) |
| `/legal` | Site | **Public.** WS-08: §22.2's eight documents and which of them are in force. Lists all eight including the ones with nothing published, because a platform whose creator agreement is unwritten should have a short list rather than a finished-looking page (#439) |
| `/legal/[document]` | Site | **Public.** WS-08: the version in force, with its number, effective date and content digest on the page — the digest is what a SİMA signature is taken over, so somebody who signed a version can check it (#439) |
| `/legal/[document]/v/[version]` | Site | **Public**, `noindex`. WS-08's archive: somebody who accepted version 3 must be able to read version 3. `noindex` so superseded terms cannot outrank the ones in force (#439) |
| `/settings` | Site | Redirects to `/settings/notifications` (#275) |
| `/settings/sessions` | Site | Session management (#27), moved into the account area by #275 |
| `/settings/notifications` | Site | §4.10's table as a grid — per category, per channel, with a digest option (#89), moved by #275 |
| `/settings/security` | Site | §4.1 A-07: enrol in two-factor, see the recovery codes once, disable (#278) |
| `/settings/privacy` | Site | §4.1 A-10 and A-11: the data export and the thirty-day closure (#279), plus §4.2 P-07's profile switch (#274) |
| `/settings/profile` | Site | §4.2 P-01 to P-03: name, biography, picture, website, location and links (#276). The picture is an address, not an upload — §13.1 |
| `/settings/email` | Site | §4.1 A-12: asks to move the account. Says plainly that nothing has changed yet (#277) |
| `/settings/password` | Site | §4.1 A-13: replaces the password. Signs the reader out, and says so before they submit (#277) |
| `/settings/language` | Site | §4.2 P-10, both halves: the interface language from §21.1's four (#280), and the display currency the reader sees amounts in (#327). The currency is a control when the platform has a published rate to offer and a sentence when it does not |
| `/account` | Site | Redirects to `/account/saved` (#275) |
| `/account/saved` | Site | §4.9 C-10: the campaigns this account saved (#288) |
| `/account/following` | Site | §4.9 C-10: the creators it follows (#288) |
| `/account/surveys` | Site | §4.8 PM-05 and PM-06: the surveys a backer owes an answer to (#289) |
| `/account/deliveries` | Site | §4.8 PM-09 and PM-10: where each reward is (#290) |
| `/pledges` | Site | §4.5 PL-09 and PL-10: everything this account has backed, and what can still be changed (#287) |
| `/pledges/[pledgeId]` | Site | §4.5 PL-09 and PL-10: one pledge — edit the tier, the add-ons and the destination, or cancel it (#287) |
| `/pledges/[pledgeId]/address` | Site | §4.8 PM-07: where one pledge's reward goes (#290) |
| `/u/[slug]` | Site | **Public.** §4.2 P-04 to P-07: somebody's profile, what they created, what they backed. 404 for a private one (#274) |
| `/notifications` | Site | The in-app inbox: read state, grouping by day, and filtering (#88), in the site shell since #345 |
| `/projects/new` | Site | Name a campaign and create the draft (#33) |
| `/projects/[id]/edit` | Site | Redirects to the first tab (#33). Inside the editor's layout, but a server redirect — nobody ever renders it, which is why its budget is an accounting figure rather than a page anyone pays for |
| `/projects/[id]/edit/basics` | Site | Title, summary, category, goal, duration, cover (#33) |
| `/projects/[id]/edit/story` | Site | Rich text story, risks, and version history (#35) |
| `/projects/[id]/edit/rewards` | Site | Reward tiers, items, add-ons, and limits (#34) |
| `/projects/[id]/edit/faq` | Site | The campaign's questions and answers (#283) |
| `/projects/[id]/edit/prelaunch` | Site | Open the pre-launch page, share the link, see who is waiting (#39) |
| `/projects/[id]/edit/review` | Site | The submission checklist, and the button that sends the campaign to review (#37) |
| `/projects/[id]/prelaunch` | Site | **Public.** The pre-launch page itself, and the reminder signup (#39), in the site shell since #343 |
| `/projects/[id]/[projectSlug]` | Site | **Public.** The campaign page, server-rendered — §10.2's `/projects/{creatorSlug}/{projectSlug}` (#119). §4.4's header, media, trust block and controls (#281) and its four tabs at `?tab=` (#282, #284, #285). In the site shell since #343 |
| `/projects/[id]/back` | — | Reward selection, add-ons, destination, and confirmation (#54) |
| `/projects/[id]/dashboard` | — | The creator dashboard shell and its overview panel -- CD-01's live totals (#93) |
| `/projects/[id]/dashboard/charts` | — | CD-02's funding trend, CD-07's reward mix and CD-08's destinations (#96) |
| `/projects/[id]/dashboard/backers` | — | CD-10's backer report with saved segments, and CD-11's CSV export (#97, #79) |
| `/projects/[id]/dashboard/finance` | — | CD-16's financial summary: gross, fees, tax, refunds, net, and the ledger underneath them (#99) |
| `/projects/[id]/dashboard/surveys` | — | §4.8's survey manager — PM-01 to PM-04 (#73) |
| `/admin` | Console | **Staff only.** §4.11's sixteen modules, which have a screen, and what the rest wait on (#294) |
| `/admin/moderation` | Console | **Staff only.** The submission queue: approve, reject, request changes (#101) |
| `/admin/moderation/[reportId]` | Console | **Staff only.** One complaint, its decision, and its full audit history (#296) |
| `/admin/moderation/profiles` | Console | **Staff only.** AD-09's queue of complaints filed against a person (#298) |
| `/admin/users` | Console | **Staff only.** Search, inspect, suspend and reinstate an account (#104) |
| `/admin/curation` | Console | **Staff only.** Editorial collections: create, publish, withdraw (#301) |
| `/admin/curation/[slug]` | Console | **Staff only.** One collection and the campaigns in it, in order (#301, #303) |
| `/admin/curation/badges` | Console | **Staff only.** Which collections grant §3.2's editorial badge (#300) |
| `/admin/curation/open-calls` | Console | **Staff only.** §4.3's programmes and the windows they are open in (#302) |
| `/admin/curation/placements` | Console | **Staff only.** The order curated collections appear in (#303) |
| `/admin/payments` | Console | **Staff only.** Every provider call, its reference, and why the refused ones failed (#304) |
| `/admin/ledger` | Console | **Staff only.** The double-entry ledger, both sides of each posting, and the balances (#305) |
| `/admin/reconciliation` | Console | **Staff only.** Whether the platform's money adds up, and what is wrong when it does not. Reports and never repairs (#106) |
| `/admin/payouts` | Console | **Staff only.** What each creator is owed, the hold it is under, and the two signatures before it leaves (#306) |
| `/admin/refunds` | Console | **Staff only.** Full and partial refunds, with a reason code and a ledger posting behind each (#307) |
| `/admin/disputes` | Console | **Staff only.** Chargebacks: notification, evidence, outcome, and the deadline each runs against (#308) |
| `/admin/fees` | Console | **Staff only.** Platform and processing rates. There is no edit — a change closes one schedule and opens another (#311) |
| `/admin/moderation/content` | Console | **Staff only.** Complaints about comments and campaign updates (#297) |
| `/admin/staff` | Console | **Staff only.** Who works here, and which of §4.11's capabilities each of them holds (#295) |
| `/admin/support` | Console | **Staff only.** Tickets with the account context and the history of what was done (#310) |
| `/admin/taxonomy` | Console | **Staff only.** Categories, subcategories and tags, with a translation per locale (#309) |
| `/admin/analytics` | Console | **Staff only.** Volume, success rate and average pledge across the platform (#313) |
| `/admin/email-templates` | Console | **Staff only.** Every transactional type, and which have been edited (#315) |
| `/admin/email-templates/[type]` | Console | **Staff only.** One template: edit, preview, test send, and every version an edit produced (#86, #315) |
| `/admin/flags` | Console | **Staff only.** Gradual rollout, with a kill switch that means what it says (#312) |
| `/admin/health` | Console | **Staff only.** Queue depth, failed jobs and provider status, measured when you open it. It does not alert (#316) |
| `/admin/audit` | Console | **Staff only.** Every privileged action the platform has recorded (#314) |
| `/robots.txt` | — | **Public.** Crawl directives, and the pointer to the sitemap index (#122) |
| `/sitemap_index.xml` | — | **Public.** The index over the sitemap segments (#122) |
| `/sitemap/[segment].xml` | — | **Public.** One sitemap segment — `pages`, `discovery`, `projects-N` (#122) |
| `/api/rum` | — | **Public**, unauthenticated. The Core Web Vitals collection endpoint (#128) |

### The three shells, which routes carry them, and how

The **Shell** column is what §4.13 WS-01 and WS-02 describe. Three values:

| Value | What it is | Where |
|---|---|---|
| **Site** | Global header, collapsing navigation, search, footer | `app/(site)/layout.tsx` → `SiteShell` |
| **Minimal** | A wordmark that goes home, and a one-line footer | `MinimalShell`, used by `app/(auth)` and by the root failure states |
| **Console** | A bar with a way back to the site, and a rail over the console's screens | `app/admin/layout.tsx` → `AdminArea` (#294) |
| **—** | No shared chrome. The page draws its own | — |

**A route does not have to live in `app/(site)` to carry the site shell.**
Several do not, and each renders `SiteShell` from a four-line layout at its own
segment: `/u/{slug}` (`app/u/layout.tsx`, #274), `/notifications` (#345),
`/projects/[id]/[projectSlug]` and `/projects/[id]/prelaunch` (#343), and
`/projects/new` and the six editor tabs (#347). Everything under
`/projects/[id]` is there of necessity: that segment also carries `/back`, and
Next allows one slug name per level, so lifting the public half into the group
would mean restructuring the private half with it. A leaf layout buys the same
chrome and leaves the siblings alone.

That is not only a convenience. It means chrome is opt-in per segment rather
than opt-out, which is what keeps the next bullet true by default instead of by
exception:

- `/projects/[id]/back` should **not** get the site header. `docs/ui-kit.md`
  §8.5 makes the checkout the one screen a white panel dominates and
  `docs/motion-system.md` §5 gives it a motion budget of near zero; a collapsing
  navigation bar offering a trip to Discover, on the screen where somebody is
  about to pledge, is the opposite of both.
- The `/admin` routes have their own shell since #294 — **Console** above. It is deliberately
  not `SiteShell`: the public header offers Discover, the categories, search and "Start a
  project", none of which a member of staff clearing a report queue wants, and `MinimalShell`
  records what importing that header costs a route which draws no navigation.

**The campaign page and the pre-launch page moved into it with #343**, and each
gave up a `<main>` of its own in the move, for the same reason the account
screens did below: `SiteShell` owns the only one on the page.

**The campaign editor and `/projects/new` joined the site shell with #347.** All
six editor tabs and the create form take `SiteShell` from a layout at their own
segment. `docs/motion-system.md` §5 gives the editor "None — autosave indicator
only" and gives the shell "One — §4.7's collapse"; those coexist because the same
table charges the collapse to the shell's own row, "paid on all of them at once",
rather than to the surface under it. `EditorShell`'s campaign title moved from a
`<header>` to a `<div>` in the same change, so the page announces one banner and
not two, and the six tabs each gave up a `<main>`.

**The account area moved into the site shell with #275.** `/settings/*`, `/account/*` and
`/pledges/*` share `AccountArea` — the site header and footer, plus a navigation over the
eight screens somebody manages about themselves. The authentication screens keep the minimal
shell for the opposite reason: a sign-in page is a screen with one job, and somebody already
signed in and changing a notification setting is not mid-transaction. `/settings/sessions` and
`/settings/notifications` each lost a `<main>` of their own in the move, because `SiteShell`
owns the only one on the page.

**`/notifications` joined the site shell with #345, and took `SiteShell` rather
than `AccountArea`.** It is the route the header's own bell links to, so a frame
that vanished on arrival read as having left the site. It is deliberately not an
account screen — its docblock argues that "this is not a setting, it is a place
somebody reads" — and it is not in `ACCOUNT_GROUPS`, so the account rail would
have drawn thirteen entries with none of them marked `aria-current="page"`. It
gave up a `<main>` of its own for the same reason the two screens above did.

**The site shell carries a floating WhatsApp control**
(`components/shell/WhatsAppLauncher.tsx`). It opens a dialog asking for a first
name, a last name and a message, and hands all three to WhatsApp as a `wa.me`
deep link on `+421 952 480 349`.

**Nothing is sent from this application.** The link opens WhatsApp with the
message written and waiting, and the visitor presses send there, so it arrives
from their own number and the reply goes back to a person. That is a deliberate
choice rather than a shortcut: sending on the platform's behalf means the
WhatsApp Business Cloud API, a Meta application, a permanent token and a
template approved in advance for any message a business starts, none of which
exists here. `lib/contact/whatsapp.ts` holds the number, the text, and the
reasoning; the copy tells the reader who presses send, and the panel afterwards
says WhatsApp is open rather than claiming delivery. It also keeps the link as a
real anchor, because a blocked `window.open` would otherwise be a form that
swallowed somebody's message in silence.

Two things about it are worth knowing before the next change to the shell:

- **It is the second animation on a frame `docs/motion-system.md` §5 budgets at
  one.** The halo and the glyph's wave are CSS keyframes in `app/globals.css`
  (written rather than imported, for the reason the drawer's are: the shell
  cannot pay 116 kB of animation runtime on every route). The movement stops on
  the surfaces §5 gives "None" — `/projects/new` and the six editor tabs — and
  the checkout never carries this shell at all, so "motion decreases as money
  gets closer" is kept by the route table rather than by a condition. **Whether
  the frame keeps a second animation is a design decision and is not settled
  here.**
- **Its dialog is dark, where §7.14 says a modal is white.** `inputSkin` fills a
  field with `--surface-3` and `Field` labels it in `--text-primary`; both are
  invisible on white, and there is no `on-white` variant of `TextInput`,
  `Textarea` or `Field` to switch to. A white panel means adding those to the
  kit. `ReportControl` met the same wall and resolved it the same way.

**The language is changed from a globe, in three places.**
`components/shell/LanguageSwitcher.tsx` is an icon with the four names behind
it: in the header from `sm` up, in the footer's bottom row at every width, and
flat inside the mobile drawer below `sm` — measured at 390px the icon pushed the
register pill and the drawer's own button past the edge of the screen, and §8.6
spends the shell's one lime element on that pill. It used to be four names
written out in the footer and nothing in the header at all, which put the only
account-free way out of a language a reader cannot read at the bottom of the
page. Each name is its own endonym, each link goes to the same page under
another prefix, and choosing one writes the cookie `proxy.ts` reads when it
answers a bare path.

**Every route is served under a `[locale]` segment (#123).** `/az/discover`, `/ru/discover`
and so on; `proxy.ts` answers a bare path with a 307 to the language the reader last
chose. `src/i18n/routing.ts` declares the shape, `src/i18n/request.ts` resolves the catalogue
from the matched segment, and `src/i18n/navigation.tsx` is what every `Link`, `useRouter` and
`usePathname` in the application must come from — a raw `next/link` drops the language and
sends the reader through the redirect, which reads to them as the site forgetting what they
picked.

**Azerbaijani is formatted here rather than by the browser (#401).** Chromium claims `az`
— `Intl.RelativeTimeFormat.supportedLocalesOf(['az'])` answers `['az']` and
`resolvedOptions().locale` says `az` — and then formats it from root-locale data: `-3 w`,
`2026 M08 14`, and a twelve-hour clock. Node's full ICU has the real data, so it is right on
the server, right in every test, and wrong in front of the reader, and no feature test can
see it. So `src/lib/i18n/formats.ts` sends `az` to `src/lib/i18n/azerbaijani.ts` on every
engine rather than only on the broken one — a client component is rendered on the server
first, and two ICUs disagreeing is a hydration mismatch. `azerbaijani.test.ts` asserts that
module is byte-for-byte what full ICU produces, which is a comparison Node can make and the
browser cannot.

**Nothing formats a date without being told the language.** `toLocaleDateString()` with no
argument is the *browser's* language, not the route's, which is how six console screens came
to render `7/27/2026` under an Azerbaijani heading. `lib/time.ts` and `lib/i18n/formats.ts`
take a `Locale` and it is a required parameter, deliberately: a default would have compiled
every call site unchanged and left them quietly wrong.

**Money is formatted the same way in all four languages, and rates are not (#403).**
`@ideanest/money` groups an amount from its digits rather than through a number — a JSON
number is an IEEE 754 double and `999999999999.99` loses its last digit on the way into one —
and it renders the ISO code after the amount because neither language the product ships in
has an agreed manat symbol. Every amount in the console goes through it. A *rate* is not
money and does belong to the reader: `lib/i18n/formats.ts`'s `numberFormat` writes `2,9%` in
Azerbaijani, `2.9%` in English, `2,9 %` in Russian and `%2,9` in Turkish, which is why a
percentage is a formatter's job and never a template's.

**Which routes are key-based, and which are still English literals (#324).** The
message catalogue lives in `messages/{az,en,ru,tr}.json` and covers, in full:

- the site shell — header, mobile drawer, account menu, footer, skip link, the search box
  in the bar and the drawer, and the failure pages in full: the two 404s, the profile 404,
  `/maintenance`, the two error boundaries and the link rail they share;
- every public route: the home page, the feed and its filter rail, the search box and its
  suggestions, the category and subcategory landings, the collection index and the
  collection pages, the three editorial pages, the public profile, and the campaign card
  those six surfaces all render;
- the six authentication screens under `app/[locale]/(auth)`, and the two credential
  panels under `/settings` that share their refusal vocabulary;
- the checkout, the public campaign page and the public pre-launch page;
- the account area: the frame, all thirteen screens' headings, one pledge's own screen, the
  notifications inbox and its settings, and the two fulfilment screens;
- the administration console, **in full** — the bar, the rail, the index that lists §4.11's
  sixteen modules, the metadata and standfirst of all twenty-eight routes, and the twenty-six
  screens inside them. `lib/i18n/admin/` holds the copy, grouped as `CONSOLE_GROUPS` groups
  the rail; `lib/i18n/admin/console.server.ts` is where a route resolves it;
- the creator dashboard, **in full** (#79) — the five panels under
  `/projects/[id]/dashboard`, their navigation and their metadata: the overview and its
  countdown, the funding trend and the two share charts, the backer report with its filter
  chips, its saved segments and its table, the financial summary down to §7.2's ledger, and
  §4.8's survey builder with the five answer types PM-03 offers.
  `lib/i18n/dashboard-copy.ts` holds the shape and one accessor per panel;
  `lib/i18n/shell-copy.server.ts` is where a route resolves it;
- the screens somebody secures or closes an account with (#80) — `/settings/security`'s
  two-factor enrolment down to the recovery codes shown once, `/settings/privacy`'s data
  export and account closure, and `/settings/sessions`' device list and its row. All four
  read their refusals from `auth.failures` rather than carrying a second spelling of them,
  which is what the email and password panels beside them already did.
  `lib/i18n/settings-copy.ts` holds the shape;
- the pledge panels (#81) — the list under `/pledges`, one pledge's own screen and the
  editor on it, and §6.2's twelve pledge states, which both screens now read from one
  group. The editor's field, its two hints and its four quote refusals are the
  **checkout's** words rather than pledge-specific copies of them:
  `components/checkout/refusals.ts` is the one function that turns a refusal into a
  sentence, and both screens call it. `lib/i18n/pledges-copy.ts` holds the rest.
- the profile editor and the visibility switch (#82) — the last English half of a pair
  whose public side was already key-based. Both halves read one namespace on purpose:
  the two describe the same six fields, and somebody who edits "Biography" should meet
  the word they saw on their own profile. `profile.editor` in the catalogue.

What is still English:

| Surface | Where |
|---|---|
| The campaign editor | `components/campaign-editor` |
| The panels below three account headings | `components/surveys`, and the saved and following lists |
| The checkout and pledge refusal table | `lib/pledges/failure.ts` — twenty refusals the checkout and both pledge screens render (#91) |
| The public report dialog | `components/moderation/ReportControl` |

`lib/pledges/failure.ts` is the one row here that is **not** a screen. It reads as
translated from both ends and is not: `checkout.errors` covers the form's own validation,
so the checkout looked finished, while the service's refusals — "That reward has just
gone", "This campaign is not taking pledges" — stayed English. #91 carries it.

`ReportControl` is the reason `lib/moderation/describe.ts` still exports `REASON_LABELS`: the
console reads the same nine reasons from `admin.moderation.reason`, and the two say the same
words in English until that dialog is translated too. `lib/i18n/wording.test.ts` asserts they
match, so the duplication cannot drift while it lasts.

**Three kinds of value in the console stay in the service's own spelling, deliberately.** A
provider name (`PAYRIFF`), a card network's reason code and a staff capability
(`ISSUE_REFUND`) are each quoted into a support conversation, a dispute or a request to an
administrator, and a translated copy would be a string nothing else in the system answers to.
The same goes for a campaign state as the scheduler and the API spell it. What the catalogue
carries beside each is the sentence explaining it.

**`packages/ui` takes copy as props and will keep doing so.** #326's comment left the
question open; the answer is props. A design-system component that reached for a catalogue
is a component that cannot be used outside one, and every component in the kit that draws a
word already takes it — `EmptyState`, `InlineAlert`, `SkeletonGroup` and `Combobox` are the
four this branch threaded copy through without touching any of them.

**The service's copy is per-language too, and it is not this catalogue.**
`apps/api/src/main/resources/messages_{az,ru,tr}.properties` hold the emails; English stays
in `messages.properties` so that a key no translation has still resolves to a finished
sentence rather than throwing. `EmailChannelSender` reads `users.locale` off the account it
already loaded for the address.

**Two suites hold the catalogue honest, and they cover different halves.**
`lib/i18n/catalogue.test.ts` asserts properties of the messages: that the four languages hold
the same keys, that none is empty, that every rich-text tag is balanced and matches English,
and that no Latin-script language contains a Cyrillic homoglyph — а, е, о, р, с, х and у are
drawn identically to their Latin counterparts, so one pasted into an Azerbaijani string reads
as correct to every reviewer while breaking search and switching a screen reader's voice
mid-word. One was found in `account.pages.surveys.intro` this way.
`app/[locale]/account-area.pages.test.ts` asserts the other half — that each page actually
*asks* for its keys, since a screen rewritten with a literal back in it passes every catalogue
check while showing English to everybody.

**How a word reaches a component, and the measurement behind it.** Server components call
`getTranslations`. Client components are handed a resolved object as a prop by their server
parent — `SiteShell` calls `shellCopy()` once and passes it to `SiteHeader`,
`MobileNavDrawer` and `AccountMenu`. They are **not** given `useTranslations`, because that
needs a `NextIntlClientProvider`, and a provider in `app/[locale]/layout.tsx` carrying only
the `shell` namespace was measured at **+24.7 KiB on every route** — `/[locale]/about` went
from 571.3 KiB of First Load JS to 596.0 KiB and six authentication routes broke their
budgets. Without it the same page is 556.8 KiB.

`src/lib/i18n/shell-copy.ts` holds the types and the pure builders and imports nothing from
`next-intl/server`; `shell-copy.server.ts` is the half that reads the request. The split is
what lets a component test build the same object out of `messages/*.json`, so the assertions
are against the words the application draws rather than words retyped into a test.

**The one exception, and it is measured rather than assumed.** `app/[locale]/error.tsx` and
`app/[locale]/(site)/error.tsx` are error boundaries, which Next requires to be client
components and renders itself — no server parent can hand them anything.
`src/lib/i18n/failure-copy.client.ts` carries their strings in all four languages — the link
rail and the skip link they share with the other failure pages, and since these two stopped
carrying English literals their own heading, body, digest line and retry button as well. Still
comfortably under two kilobytes, and `failure-copy.client.test.ts` asserts every one of them
against the catalogue so the two cannot drift. A **third such surface** should re-measure the
provider rather than extend that file; a word these two already draw belongs in it.

**The console is in scope now, and #294's exemption is withdrawn.** That issue argued that
§21.1's catalogue exists for the product's readers while the console's readers are the
people who operate the platform, so sixteen module descriptions in four languages was four
times the strings to keep current for nobody. The decision has been reversed deliberately
rather than forgotten: the platform is to be legible in all four languages to everyone who
uses it, staff included. `lib/admin/navigation.ts` keeps the old argument as the record of a
decision that was taken and then changed, and `lib/i18n/admin-copy.ts` states what replaced
it.

**What the split used to be, and why it is gone.** The catalogue was reached through a
cookie, and reading a cookie makes a render dynamic. The account area is authenticated and
renders per person already, so it paid nothing; `/`, the category landings and the static
pages are cached shared renders that a per-visitor language would have turned into a render
each, on the largest contentful paint of the pages a stranger meets first. So the public half
stayed in English for a performance reason rather than a scheduling one.

A path segment removes the trade rather than improving it. `/az/discover` and `/ru/discover`
are different URLs, so each is a cached render of its own and neither has to ask who is
asking — the build output prints four `●` prerenders per static route where it printed one.
`app/[locale]/layout.tsx` declares the segment as the document's `lang`, so `AccountArea` no
longer needs its `<div lang>` override, and `SITE_LANGUAGE` survives only in
`app/global-error.tsx`, which replaces the document after the layout that would have known
the language failed. `docs/architecture.md` §21.1 carries the full argument.

**`/settings/language` carries both halves of §4.2's P-10 since #327.** It was one
preference and a sentence: the currency was stated as a fact, because §21.2's display
currency needs a published rate and the service had none. #327 built the source — the
Central Bank of Azerbaijan's daily publication, refreshed hourly — so the sentence became
a control, on the same page rather than a route of its own. Two Saves over two writes,
because a language that failed to save because a currency did would be one form doing two
unrelated things.

The options come from `GET /v1/exchange-rates`, read **on the server**: it is public and
marked `public, max-age=600`, so Next holds one copy for everybody and the `<select>` is
drawn from the first byte rather than after a round trip. A deployment that can offer
nothing — the feature off, the source unreachable past its limit — gets the sentence back,
which is #280's shape and the reason it was right.

**The public site shows no approximation, and that is a performance decision rather than a
gap.** A figure beside a campaign's goal would have to know who is reading, and `/`, the
category landings and the campaign pages are cached shared renders — the same argument
`src/i18n/request.ts` makes about the language, which #123 answered with a path segment. A
currency has no equivalent: `/az/usd/discover` is a cache entry per pair. So the
approximation belongs on the routes that are already per-person, and `@ideanest/money`'s
`approximate` is what draws it there.

**There is no route for the two-factor challenge (#272).** It is a state of the sign-in form.
The challenge `POST /v1/auth/login` returns is a credential for the next few minutes — the
service marks the response `no-store` — and a URL is where a credential must not go: query
strings are written to access logs, kept in history, and forwarded in the `Referer` header of
whatever loads next. `TwoFactorChallenge` carries the full argument.

**The console is thirteen routes and nine of §4.11's sixteen modules, and `/admin` says
which.** #259's definition of done is that every module has either a screen or an open
blocker naming what it waits on, so the console's front door lists all sixteen: the nine that
work link to their screens, and the seven that do not say what they are blocked on and which
issue owns it. `lib/admin/navigation.ts` is the single list behind both that page and the
rail, and `navigation.test.ts` asserts the two cannot disagree — a rail entry belonging to no
module, or a screen in no rail, fails the suite.

**None of those routes is a gate, and none of them may become one.** Every endpoint the
console calls checks the caller itself, and answers two different refusals — a stranger is
told they do not work here, and a colleague is told which capability the screen wanted, in
`meta.capability`. Each screen renders the one it was given. A check in a layout would be a
second, weaker copy of one the service already makes correctly, and the dangerous direction
is the one where the browser says yes.

#295 built the role model this paragraph used to say did not exist. #400 is what it cost to
keep rendering only the first of the two refusals afterwards: a moderator opening the payout
queue was told they were not a moderator.

**`/maintenance` has no switch in front of it.** It is a page an edge or a load
balancer can be pointed at during a planned outage, and nothing in this
application redirects to it. Whatever performs the switch is a deployment
concern and belongs with #139's environments work; the honest scope of #263 was
to ship the page.

**Two failure states, two frames.** `app/not-found.tsx` and `app/error.tsx` sit
at the root of the route tree, because Next serves them for a request that
matched nothing and for a throw anywhere — and a root file's client components
land in **every** route's first load. Rendering the full site header there cost
83.3 KiB on the checkout, on every editor tab and on the admin console, none of
which use it; `apps/web/performance/README.md` records the measurement. So the
root pair uses `MinimalShell`, and `app/(site)/not-found.tsx` and
`app/(site)/error.tsx` render the same failure state inside the full shell,
where it is already paid for.

**The first segment of the campaign page is a creator's slug, and the folder is
called `[id]` anyway.** Next allows exactly one slug name per dynamic level, and
`app/projects/[id]/` already carries the creator's own routes, where the segment
really is a campaign identifier; a sibling `[creatorSlug]` is a build error. The
URL is correct and the folder name is a framework artefact — see the page's own
comment. Renaming it belongs with whatever moves the creator's routes out from
under `/projects`.

Every route above declares its metadata through `src/lib/seo/metadata.ts` — see
[Metadata and social previews](#metadata-and-social-previews).

## The session, and where it is read

`SessionProvider` is mounted on the **root** layout and bootstraps once per page
load: it spends the `HttpOnly` refresh cookie against `POST /v1/auth/refresh`,
holds the fifteen-minute access token in a module variable, and reads
`GET /v1/me`. Everything under it — the header, the drawer, and the route guard
— asks that one provider rather than fetching for itself.

**Issue #267 asked for the session to be read on the server, and it cannot be
read there.** The refresh cookie is issued on `Path=/v1/auth`
(`ideanest.auth.refresh-cookie.path` in `apps/api`), and a browser sends a
cookie only to paths under its own — so a request for `/`, or for any page in
this application, carries nothing for `cookies()` to read. There is no session
on the server to expose, whatever this application does.

That scope is not an accident to route around: `AuthProperties.RefreshCookie`
narrows it deliberately, so a thirty-day credential is not attached to every
request to the API. Widening it is a change to the service and belongs to
whoever owns §17, not to an epic whose stated scope is "the web client only".
**What it costs today** is one round trip after hydration before the header
knows who is reading, which is why the header renders a neutral placeholder
rather than guessing. #267 is left open for the server half.

The guard lives in the same provider, so no private route has to remember to
guard itself. `src/lib/session/private-routes.ts` is the list it uses, and it is
deliberately **not** `PRIVATE_PATH_PREFIXES` from the SEO module — "must not be
indexed" and "requires a session" are different questions, and the pre-launch
page and the checkout are in one list and not the other.

Every public route in the site shell — `/`, `/discover`, `/search`, `/categories`
and its landing pages, `/u/{slug}`, the campaign page and
`/projects/[id]/prelaunch` — works with no session at all, and so do the three
authentication screens. `/projects/[id]/back` is the half-way case: its reward list is
`permitAll` and reads through `publicFetch`, so the prices render for a visitor
who has not registered, and only the two mutations need a session. For the pre-launch page the reason is the followers it exists to
collect, who have not registered; for discovery it is that a visitor who has not
registered is the entire audience — requiring a token would mean the front door
could not render. Both read through `publicFetch`, which sends a bearer token
only when one is already in memory and never fetches one.

## The verification link

`POST /v1/auth/register` issues a token and the service sends the message that
carries it (`RegistrationService` publishes `EmailVerificationRequested`). The
link in that message resolves against
`ideanest.notification.email.base-url`, which is this application's origin, and
it must point at:

```
{WEB_BASE_URL}/verify-email?token={token}
```

That path and that parameter name are the whole contract between the two halves,
which is why they are written down here as well as in the page's own comment.
The page reads the token out of its own URL and sends it in a **body** —
`VerifyEmailRequest` gives the reason: a query string is written to access logs,
kept in browser history, and forwarded in the `Referer` header of whatever the
page loads next, and this value is a credential until it is spent.

**There is no resend.** `RegistrationService` answers a second registration for
an existing address by publishing `RegistrationAttemptedOnExistingAccount` and
returning, and it issues no new token. So the expired-link page offers no resend
button that would do nothing, and says what does work instead — signing in,
which `SignInService` deliberately allows before an address is verified. The
account menu carries the unverified state from there.

### The other two links, on the same contract

#271 and #277 added two more messages with a token in a URL, and neither the API
nor a mail transport builds those URLs yet (#86), so this file is where they are
written down. Both resolve against the same
`ideanest.notification.email.base-url` and both must point at:

```
{WEB_BASE_URL}/reset-password/confirm?token={token}      # A-06, one hour
{WEB_BASE_URL}/confirm-email-change?token={token}        # A-12, six hours
```

Each page reads the token out of its own URL and sends it in a **body**, for the
reason above and one stronger: spending the first sets a password, and spending
the second moves the address a password reset is sent to. `ResetPasswordRequest`
and `ConfirmEmailChangeRequest` both restate the argument.

**Unlike verification, the reset link has a resend and the address change does
not.** `/reset-password` can be asked again by anybody — it answers 202 either
way, so offering it costs nothing and discloses nothing, and asking again retires
the previous link. The address change cannot: asking again requires the current
password and a session, so a dead confirmation link sends the reader back to
`/settings/email` rather than offering a button that would 401.

**`weak-password` on the reset does not withdraw the form.** The service checks
the password policy before it claims the link, so the token survives a rejected
password and the page keeps both. That is the one refusal on either screen that
leaves the form usable, and it exists because the alternative — burning a
single-use, one-hour link on a typo — is this flow's most common support ticket.


## Server rendering

`docs/architecture.md` §4.4 and issue #119. The requirement is not "renders on
the server" — every route here already did — but that **the content is in the
initial HTML rather than assembled by the client**. Two routes were failing it,
in different ways.

| Route | Before | Now |
|---|---|---|
| `/projects/[id]/[projectSlug]` | Did not exist. Every campaign link in discovery pointed at a 404 | A Server Component with no `'use client'` beneath it. Title, summary, creator, funding figures, story, risks and reward tiers are all in the first response |
| `/discover` | Shipped an empty grid and fetched page one from the browser | The first page is fetched on the server for whatever filters the URL names, and handed to the view |

### How the two reads work

`src/lib/api/server.ts` is the server-side counterpart of `lib/api/client.ts`,
and the split is not cosmetic. The client module issues a **relative** `/v1`
request, which is same-origin in a browser because `next.config.mjs` rewrites it
— the only arrangement in which a `SameSite=Strict` refresh cookie travels — and
which throws `Failed to parse URL` in a Server Component, where there is no
document, no origin, and no rewrite. Server reads therefore resolve against
`IDEANEST_API_ORIGIN` directly, exactly as the sitemap already did.

Everything there is **anonymous**, and that is a decision. A server render that
varied by session could not be cached by anything, shared by anybody, or served
to the crawler the work exists for. A signed-in visitor's personal additions —
whether they have saved a campaign, whether they have backed it — belong to a
client component that fetches them after hydration, because those are the parts
that must not be in a shared cache.

**A refused read is `null` and never a thrown page.** The campaign page turns
`null` into a 404; discovery passes nothing and the view fetches page one itself,
which is exactly what it did before. A visitor whose first request lands during a
restart sees the skeleton and then the feed rather than an error. A *bug* —
a malformed base URL, say — is allowed to surface, because swallowing it would
turn a misconfigured deployment into a site where every campaign has quietly
stopped existing.

### What is deliberately not server-rendered

The creator dashboard (#93). It is one creator's view of their own money behind
a bearer token, and the service answers it `no-store` — none of the three
reasons above applies to it. `lib/api/server.ts` sends no token by design, so
there is nothing for a Server Component to read, and a render that varied by
session is exactly what that module refuses to do. The panel fetches after
hydration, like the moderation queue, and its loading state is honest: those
figures move while you are looking at them.

Reading this table as "server rendering is better" would be the wrong lesson.
The rule is that content a stranger and a crawler need belongs in the first
byte; content only one signed-in person may see does not, and putting it there
costs the cacheability that made the rule worth having.

### The one client component beneath the campaign page (#91)

`LiveFunding` is §12.1's counter, and it is the exception that proves the rule
above rather than a hole in it. **Every number it renders is in the initial
HTML**, from the server's read — a crawler, a link unfurler and a reader with no
JavaScript see the campaign's real totals. What hydration adds is arithmetic on
top of them: the socket carries "40.50 arrived since I last spoke", never a
total, so the component starts from the server's figure and adds each delta. A
client component that *fetched* these numbers would break #119; one that starts
from them does not.

**It is opt-in and unset by default.** `next.config.mjs` says the browser never
learns the API's real origin — it talks to this application, and `/v1` is
rewritten server-side — and a WebSocket cannot use that rewrite, because Next
does not proxy an upgrade. So `IDEANEST_REALTIME_ORIGIN` is absent unless a
deployment has somewhere to point it, and with nothing configured this page
behaves exactly as it did before. The API's `ideanest.realtime.allowed-origins`
is the compensating control on the other side; a handshake is not subject to
CORS, so the origin check has to be the server's own.

**What it cost, and what that teaches about client components here.** The route
went 60 KiB over its First Load JS budget, which is now 580 rather than 492.
Two thirds of the original overage was avoidable and was avoided: a client
component pulls its **whole import graph** into the browser bundle, so
`@ideanest/ui` became `@ideanest/ui/server` — the lean entry is the right one
from a client component too — and `completionOf` moved out of `publicPage.ts`
into `lib/projects/completion.ts`, a leaf whose only dependency is `decimal.js`.
What remains is `decimal.js` itself, which is not negotiable: CLAUDE.md forbids
floating point for money, and this is the one place on the platform where an
amount is accumulated repeatedly in a browser.

**The backer count is deliberately not live.** A window carries how many pledges
were confirmed, and a pledge is not always a new backer — somebody raising their
pledge confirms again. Adding it would make the count drift upwards over a
campaign's life with no way to correct itself, which is worse than a count that
is right at page load.

### The seeded feed

`useDiscoveryFeed` takes an optional first page carrying the filter key it was
fetched for. It is adopted only while it answers the question being asked, so a
page fetched for `?status=live` is never shown under `?category=games`; when the
key matches, the browser does not request page one again. Changing a filter is
`router.push` to the same route with a different query, which re-runs the Server
Component and produces a fresh seed for the new key.

**`/discover` is dynamic rather than static as a result.** That is the direct
cost of rendering a filtered feed on the server, and it is the trade #119 asks
for: a static page with an empty grid has nothing in its HTML. The single
canonical URL is unaffected and stands on its own argument — the filters select a
subset of one corpus, and indexing every combination would spend the whole site's
crawl budget on permutations of one list.

### Typed against the published contract

Both reads go through `@ideanest/api-client`, generated from
`apps/api/openapi.json`. Every property on a generated response type is optional
— springdoc marks a field required only when it can prove it — so
`src/lib/projects/publicPage.ts` narrows once, in one place, and answers `null`
for a response that is not a campaign rather than letting a component print
`undefined` into somebody's page.

### `@ideanest/ui/server`

A Server Component may not import the root barrel: several of its members consume
`createContext`, and `next build` refuses the route outright, naming a component
the page never used. The stateless members are re-exported from
`@ideanest/ui/server`, and `packages/ui/src/server.test.ts` walks everything
reachable from it and fails if any of it acquires a hook. The rule used to be a
comment in `app/discover/page.tsx` asking people not to; it is now a boundary.

## Running it in a container

`ops/deploy/README.md` owns the deployment story; two things about the image
belong here because they are properties of this application rather than of the
pipeline.

**`IDEANEST_SITE_URL` is a build argument, not an environment variable.**
`lib/seo/metadata.ts` writes every canonical URL, `og:url`, sitemap entry and
absolute social-image URL against it, and `output: 'standalone'` bakes it into
the statically rendered pages. An image built with the default and deployed to
production serves a sitemap full of `localhost`, which a crawler believes. One
image per site URL is therefore unavoidable, and making it an argument is what
stops somebody discovering that at run time.

`IDEANEST_API_ORIGIN` is the opposite and is read at request time, so one image
runs against staging and production alike.

**The health check is `/en/about` and not `/`.** The root path is a 307 to a
language. A check that follows redirects would pass on a broken application; one
that does not would fail on a working one. A localised static page exercises the
router, the proxy and a render, which is what the check is for.

The build context is the repository root — this application compiles three
source-only workspace packages — and `.dockerignore` is what keeps that context
to a few megabytes instead of the whole checkout.

## Accessibility

`docs/ui-kit.md` §9 and issue #129. The audit covered discovery, the campaign
page and the checkout — the three surfaces a stranger walks through on the way
to spending money — plus the shell that wraps all three.

It found six defects, all invisible on screen.

**Two heading ladders with a level skipped.** Discovery went from the page's
`<h1>` straight into every campaign card's `<h3>`, so a reader navigating by
heading met two hundred headings with nothing naming what they were a list of;
the checkout went from its `<h1>` into "Add-ons" at level three. The first is
fixed with a visually hidden `<h2>` that also names the results list, the second
by promoting the section's own heading. Neither changes a pixel.

**Four uses of `--text-tertiary` for text that has to be read**, at 3.8:1 —
below WCAG 1.4.3's 4.5:1 for normal text. The footer's entire link list, the
subcategory links on `/categories`, the not-found page's suggestions, and the
sentence a profile shows when somebody has written no biography. All four had
taken `docs/ui-kit.md` §9.1 at its word, and the table was wrong: it recorded
that token at 4.9:1 and called it "AA at 16px+". The table is computed now, and
the four are `--text-secondary` at 8.2:1.

### What is enforced, and where

| Check | Where | Why there |
|---|---|---|
| Automated rule pass (names, roles, labels, heading order, list structure) | `src/test-axe.ts`, called from the suites for the three flows and the shell | Runs against the same fixtures those suites already build, so a fixture that drifts drifts once |
| Every click handler is on something a keyboard can reach | `src/accessibility-rules.test.ts` | A static scan, because a `<div onClick>` renders and behaves correctly for a mouse and no rendered check can see the difference |
| No control is drawn in `--text-tertiary` or `--text-disabled` | `src/accessibility-rules.test.ts` | The same scan. Text inside a control clears 4.5:1 whatever its size, and hovering to make a link legible is not something a reader can be asked to do |
| Contrast | `packages/ui/src/contrast.test.ts` | Computed from the tokens. jsdom applies no styles, so axe's colour rule is inert here and is disabled with a note saying so |
| Focus order, focus movement between steps, keyboard operability of a specific control | Ordinary assertions in each flow's suite | Judgements. No tool decides whether the order is the *right* order |

The automated pass deliberately runs a named rule set rather than the default
one. The defaults include rules about a whole document — one `<main>`, a page
title, a language on `<html>` — and every one of these tests renders a fragment
into a bare `<div>`. A fragment failing "the page has no `<h1>`" is a true
statement about a `<div>` and says nothing about the application, and a suite
full of those is a suite people learn to ignore. The document-level rules are
asserted where they belong, in the layout and shell suites.

### Contrast is arithmetic now, not a promise

`CLAUDE.md` says contrast failures are build errors, and until #129 nothing
computed one. The token pairs the system actually draws are measured against
WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text, focus rings and status
marks. Translucent tokens are composited over a named surface first, because
`rgba(255,255,255,0.64)` has no ratio of its own — what a reader sees is white
over whichever surface is behind it, and the answer genuinely differs.

The two failures the ui-kit warns about in prose are asserted as failures:
`--lime-500` as text on white measures 1.28:1, and `text-white/64` on a lime
card measures 1.16:1. Pinning them keeps the reason attached to the rule —
somebody who changes the lime ramp and quietly "fixes" those tests has changed
the brand, not the accessibility of one label.

## The financial summary

`docs/architecture.md` §4.7's CD-16 and issue #99. `/projects/[id]/dashboard/finance`,
reading `GET /v1/projects/{id}/finance`, guarded by `VIEW_FINANCES` — the same
capability the backer report takes, and for the same reason: this is money, and
a collaborator brought on to write the story has no business reading it.

### The whole breakdown, never the net alone

A creator on this screen is asking "why was I paid this", which is five
questions rather than one. So every deduction is a row and the rows add up in
front of the reader, and the ledger's own balances are published underneath
them — so the total can be checked against something rather than taken on trust.

Nothing is added up in the browser. Every figure arrives as a decimal string and
is printed; a panel that re-derived a net would be a second answer to a question
the service already answered, and it would be an answer computed in a double.

### `basis` is not decoration

Before a payout has been calculated the fees are what §5.2's schedule *would*
charge; afterwards they are what it *was* priced at, read from the payout row
rather than worked out again. Those are different statements about somebody's
money, so the panel carries a badge that says which, and the projected version
says in a sentence that the figures can still move. A campaign that runs across
a rate change is quoted at today's rate and paid at that day's, and the fee
schedule's identifier is on both.

### Two zeroes that are not the same zero

**Tax.** §4.10 is #78 and is blocked on a legal answer, so nothing withholds any
and the figure is zero on every campaign. A bare "− AZN 0.00" reads as "no tax
is due on your earnings", which is not something this platform is in a position
to say — so the row says that IdeaNest withholds none and that what is owed is
between the creator and their tax authority.

**`platform_fee` in the ledger.** It is zero for a different and worse reason:
nothing posts the fee split. A collection debits escrow and credits the creator
for the gross; a payout does the reverse for the net; the difference stays in
escrow as a balance no account claims. `CollectionRun` and `PayoutPostings` each
say the other one posts it. That is #69's to close, and the panel does not
paper over it — the balances are published exactly as they are, which is what
lets somebody see the gap.

`reconciled` is therefore a narrower claim than it sounds: it says this
campaign's entries sum to zero per currency, which a database trigger already
enforces. It is worth showing because the one way it can be false is a row that
arrived past both the application and that trigger — and that is the day
somebody needs to see it rather than be reassured.

## Caching and revalidation

`docs/architecture.md` §4.13 and issue #127. Three layers, and each answers a
question the one above it cannot.

### The data cache, and why sixty seconds is not enough on its own

Every public read carries `next: { revalidate: 60 }`, matching the
`Cache-Control` the service puts on the same read. That bounds load and it does
not bound *wrongness*: a backer who pledges watches the total they just moved sit
unchanged for up to a minute on the one page where the number is the point, and a
creator who publishes an update sends people to a page that does not have it yet.

Shortening the window is the wrong fix. It costs every reader of every campaign a
request to make the one campaign that changed correct sooner, and it still does
not make it correct *now*.

So every public read is also tagged. `src/lib/cache/tags.ts` holds the
vocabulary — the campaign by address and by identifier, the taxonomy, the
collections, one profile — and the service names the campaign that changed.

**A pledge deliberately does not invalidate the discovery feed.** A pledge
changes the amount raised, which changes the ordering of a feed sorted by
momentum, so on paper every pledge on the platform invalidates every feed page.
That is a cache which is empty at any interesting traffic level, bought with a
reader seeing a slightly older ordering of campaigns they have not chosen yet.
The feed keeps its minute, and `discovery` is evicted only by the events that
change what is *in* it — a launch, and the two ways a campaign ends.

### `POST /api/cache/revalidate`

Authenticated with a shared secret in `IDEANEST_REVALIDATE_SECRET`, compared in
constant time. **With no secret configured it refuses everything**, rather than
allowing everything: a deployment that lost the variable would otherwise come up
with the door open and nothing would say so.

The secret is not protecting confidential data — the tags name public pages — it
is protecting the cache. An endpoint that evicts by name and asks for no proof is
a request anybody can send in a loop to turn every cached render into an origin
fetch, which is a denial-of-service against the service the cache exists to
shield.

The tag vocabulary is closed and an unrecognised tag is **named in the response**
rather than ignored, because a caller whose tag was silently dropped would
believe the page had been refreshed and would go looking for the fault on the
wrong side. The realistic threat is a caller with the secret and a bug: an empty
string, or a wildcard, both of which would evict everything.

The far side is `az.ideanest.shared.cache` in `apps/api`, which is configured
with `CACHE_REVALIDATE_URL` and `CACHE_REVALIDATE_SECRET`. Everything it does is
a hint: it never throws, it never blocks the outbox relay that feeds it, and it
drops rather than queues when the web client is unreachable. A hint that is lost
costs a page that is briefly stale, which is what the window above already
guarantees.

### `Cache-Control` for a shared cache

`src/lib/cache/publicRoutes.ts`, applied in `proxy.ts`. Public pages are
served `public, s-maxage=60, stale-while-revalidate=600`; everything else keeps
the framework's `private, no-store`.

This is safe because **every server render in this application is anonymous**,
and that is a property rather than a coincidence: the refresh cookie is issued on
`Path=/v1/auth`, so a page request carries no session, and nothing under `src/`
calls `next/headers` at all. A signed-in reader and a stranger are served the
same HTML and the difference appears after hydration.

It is an allow-list of path shapes rather than a deny-list, and it is a function
rather than a `headers()` entry in `next.config.mjs`, because the campaign's
public page is `/{locale}/projects/{id}/{projectSlug}` and the creator's editor is
`/{locale}/projects/{id}/edit`. A path pattern that matches the first matches the
second, and the shape of that mistake — a creator's draft marked publicly
cacheable — is invisible in review and obvious in production.

## Metadata and social previews

Every title, description, canonical URL, and social card is built by
`src/lib/seo/metadata.ts` (#120). No page writes an `openGraph` block of its own:
a page that did would be the page that forgot `og:site_name`, or spelled the
locale differently, or printed the site name into `og:title` where
`og:site_name` already says it — mistakes that render identically in review and
are visible in every shared link forever.

| Module | Holds |
|---|---|
| `lib/seo/metadata.ts` | `publicPageMetadata`, `privatePageMetadata`, `projectPageMetadata`, the canonical rule, word-boundary truncation, and the §6.1 public/private split |
| `lib/seo/metadata-source.ts` | The one server-side, **anonymous** read of a campaign's public projection |
| `lib/seo/metadata-card.tsx` | The Open Graph card, drawn from `@ideanest/design-tokens` |
| `app/opengraph-image.tsx` | The site's card. Static — rendered once by `next build` |
| `app/discover/opengraph-image.tsx` | The same card for `/discover`, and it is **not** redundant (see below) |
| `app/projects/[id]/prelaunch/opengraph-image.tsx` | A campaign's card, per request |

**Two shapes, because there are two kinds of page.** A public page gets a
canonical, a full Open Graph block, and a large X card. A private one —
`/projects/[id]/back`, `/projects/new`, `/settings/sessions`, `/notifications`,
`/settings/notifications`, every editor tab —
gets `noindex, nofollow`, no canonical, and no card at all. `nofollow` as well as
`noindex` on all of them: they are shells around client boundaries, so the markup
a crawler receives has no links in it, and `follow` would be a promise of crawl
budget spent finding nothing.

**One canonical for the whole of discovery, and every query string is dropped.**
The filters live in the query string and the feed they select is fetched in the
browser, so `/discover`, `/discover?category=games`, and
`/discover?utm_source=news&page=7` are all served the *same document* — one
canonical is what actually happened rather than a simplification. Emitting a
per-filter canonical would mean reading `searchParams` inside `generateMetadata`,
which was measured to move `/discover` from `○ (Static)` to `ƒ (Dynamic)` in the
build output. A per-request render of the front door is not worth a tag.

**A campaign's card is its own cover photograph when it has one.** §5.3 requires
a cover of at least 1024×576, and an unfurler holding a real photograph should
not be shown typography instead. With no cover — which, until the media pipeline
of §13.1 exists, is most campaigns — the `opengraph-image` route draws the title
and summary onto the site's card. It deliberately embeds no bitmap: Satori
decodes PNG, JPEG, and SVG, while §13.1 serves AVIF first.

**Nothing about a campaign is printed until it is confirmed public.** The
projection is read anonymously, without credentials, because what a link preview
may show is exactly what an anonymous request answers — a card built from an
authenticated read would say more than its audience may see. `PRELAUNCH`,
`SCHEDULED`, `LIVE`, and the five post-funding states are public;
`docs/architecture.md` §6.1's other seven are not, and a campaign in one of them
gets the private shape with no title, no summary, and no cover. A service that
does not answer is treated the same way: a brief `noindex` is re-crawled and
recovers, an indexed draft does not.

**`app/discover/opengraph-image.tsx` is load-bearing.** Next merges a file-based
Open Graph image into the metadata of the segment the file sits in, and a child
segment that declares its own `openGraph` block replaces its parent's resolved one
wholesale. `/discover` declares one, so without a card in its own directory it
would have no `og:image` at all. Any future public route with its own title needs
the same file, or an explicit image.

**Not done here.** `sitemap.xml`, `robots.txt`, and the finer question of which
*public* pages should be indexed are #122's (`lib/seo/indexability.ts`).
`isPubliclyVisible` is the floor both rest on: nothing it refuses may be indexed
or described, whatever that module decides on top.

## Discovery

`/discover` is a client route and its state is the query string. Every filter
and the sort are parameters the service itself defines, so a filtered feed is a
shareable URL (D-12), survives a reload, and comes back off the back button. The
**cursor is deliberately not in the URL**: a shared link should open a fresh
first page rather than page seven of somebody else's scroll, and a cursor is
fingerprinted to the query it was issued for, so one in a link would be answered
`400 DISCOVERY_CURSOR_MISMATCH` the moment the recipient touched a filter.

| Module | Holds |
|---|---|
| `lib/discovery/vocabulary.ts` | The closed vocabularies, copied from `az.ideanest.discovery.domain` |
| `lib/discovery/filters.ts` | The filter state, the URL it serialises to, and the active-chip set |
| `lib/discovery/bounds.ts` | The custom money range, checked with `decimal.js` |
| `lib/discovery/api.ts` | `GET /v1/discover` and `/v1/discover/facets` |
| `lib/discovery/useDiscoveryFeed.ts` | D-04's paging, and the one-request-per-cursor guard |
| `lib/discovery/useDiscoveryFacets.ts` | D-10's live counts |
| `lib/discovery/emptiness.ts` | Which filter emptied the feed |

**Filters the service refuses today are not rendered.** Location (country, city,
proximity), `showOnly=saved`, `showOnly=recommended`, `showOnly=featured`, free
text, `sort=relevance` and `sort=near_me` are all representable on the service's
query object and answered with `400 DISCOVERY_OPTION_UNSUPPORTED` naming the
issue that owns them (#43, #44, #47, #48). A control that cannot work is a
promise the interface breaks the first time somebody uses it, so they are absent
rather than disabled.

**Infinite scroll is the enhancement, not the mechanism.** There is a real
"Show more projects" button and an `IntersectionObserver` that presses it. The
other way round is how a feed becomes unreachable by keyboard and by screen
reader, because neither produces a scroll that intersects anything.

## Sitemaps and robots

`src/lib/seo/` holds one decision — **may this campaign be indexed** — and the
files that act on it.

### The indexability rule

`src/lib/seo/indexability.ts` answers for **all sixteen** project states of
`docs/architecture.md` §6.1, one of three ways. The table is a
`Record<ProjectState, …>`, so a seventeenth state is a type error rather than a
campaign that quietly defaults to indexable, and a state this build has never
heard of is treated as **not public** — it fails closed.

| Answer | States | Why |
|---|---|---|
| `NOT_PUBLIC` | `DRAFT`, `SUBMITTED`, `CHANGES_REQUESTED`, `REJECTED`, `APPROVED`, `SCHEDULED`, `SUSPENDED` | §4.3: discovery never returns these under any filter or sort. The service states the same seven independently as `DiscoveryStatus.HIDDEN_STATES` |
| `PUBLIC_NOT_INDEXABLE` | `PRELAUNCH`, `CANCELED` | Reachable, deliberately not indexed. A pre-launch page is an **unmoderated** teaser — `DRAFT → PRELAUNCH` passes no review — on an id-based URL that stops existing when the campaign opens. A cancelled campaign stays reachable for the backers who have the link, but a permanent search result for a withdrawn campaign is a dead end outranking the live ones beside it |
| `INDEXABLE` | `LIVE`, `LATE_PLEDGE`, `SUCCESSFUL`, `COLLECTING`, `FULFILLING`, `COMPLETED`, `UNSUCCESSFUL` | Public, moderated, and stable — §4.4's project page is the page a backer is looking for |

**One predicate, both surfaces.** `isIndexableProjectState` is what the sitemap
filters on, and `projectPageRobots` is the same decision shaped as a `robots`
meta directive for the campaign page, which renders it since #119. Both read the
same table, so a page that says `noindex` while the sitemap advertises it is not
a state this application can reach — and that state is a crawler being invited to
a page and then turned away from it.

`follow` stays true when `index` is false: a withdrawn campaign still links to
its creator and its category, and those pages are indexable.

### Segmentation

Next's `generateSitemaps` maps `src/app/sitemap.ts` onto `/sitemap/{id}.xml`, one
file per segment, and `src/app/sitemap_index.xml/route.ts` is the
`<sitemapindex>` over them — Next writes no index of its own, and taking
`/sitemap.xml` for a route handler would collide with the metadata route.
`robots.txt` points at the index and not at the segments, so the shard count can
change without a redeployment.

| Segment | Holds |
|---|---|
| `pages` | `/` and `/categories` |
| `discovery` | The unfiltered feed, plus one URL per category and subcategory |
| `projects-N` | Indexable campaigns, 45,000 per shard |

**`discovery` reads the taxonomy at request time** rather than listing it. §4.3
requires the taxonomy to be editable without a deployment, so a frozen array of a
hundred paths is a sitemap that is wrong the first time an administrator renames
anything. `fetchCategories` caches the read for an hour, so a crawl of several
segments costs one request; a read that fails leaves the feed alone in the
segment, because a sitemap that 500s is an error reported against the whole site
and one that is briefly shorter is a sitemap.

**45,000 and not 50,000.** The limit is 50,000 URLs and 50 MB uncompressed, and a
file that breaches either is rejected whole rather than truncated. There is
always at least a `projects-0`, empty if need be: an index referencing a segment
that 404s is an error in Search Console, and a segment whose URL appears and
disappears with the campaign count is one nobody can submit.

Segmenting by content type is not only about size. The three kinds change at
completely different rates, and a crawler can skip a segment whose contents have
not moved — which is impossible to say about a file mixing a campaign that
changes hourly with a page that changes yearly.

### What is claimed about each URL

`lastModified` comes from the campaign's own timestamps: `launchedAt`, and
`deadline` **once it has passed**, because the page changed at that moment from
one taking pledges to one that succeeded or did not. A deadline in the future is
a promise rather than a modification. A campaign with neither gets **no**
`<lastmod>` — `new Date()` would tell a crawler that every page changed on every
crawl, which is how the field comes to be ignored for the whole file. The public
listing carries no `updatedAt`; if one is ever added, this is the one function
that reads it.

`changeFrequency` is a statement about the content and is true: `daily` for a
live campaign, whose amount raised and backer count move every day; `monthly`
through fulfilment, which posts updates over weeks; `yearly` for a page that is
finished.

**There is no `priority`, anywhere, deliberately.** It asks for relative
importance within the site on a scale with no defined meaning, Google states that
it ignores the field, and there is no number here that would be true if it did
not. A field invented to fill a column is a field a reviewer has to pretend to
check.

### What robots.txt refuses

`Allow: /` first and the exceptions after, rather than the reverse — a robots.txt
built the other way round quietly stops indexing every page added after it was
written. The exception list is `PRIVATE_PATH_PREFIXES`, beside the predicate, and
it covers the pledge flow, the campaign editor, the pre-launch teaser, the
account, the creator dashboard, the pledge manager, administration, and the
proxied `/v1` API. **Several of those had no route when the list was written** —
the dashboard and the two admin screens have one now, the account settings shell
(#275) does not yet — and all of them were disallowed from the start anyway: a
private surface has to be disallowed on the deploy that introduces it, and a
robots.txt updated afterwards is updated too late.

`Disallow: /discover?` blocks **every filtered permutation of the feed**. §4.3's
filters are query parameters, they compose, and several are comma-separated
lists, so the number of URLs describing one set of campaigns is combinatorial and
each is crawl budget spent on a page that already exists. That includes `?q=`,
where the URL set is whatever anybody types. `/discover` itself, with no query,
is allowed and is in the sitemap.

`Disallow: /search` blocks WS-06's results route for the same sentence: a
different endpoint with the same property, that the URL space is written by
whoever types in the box. The bare `/search` is disallowed with it rather than
carved out — it holds a form and no content of its own.

`/sign-in`, `/register` and `/verify-email` join the list too. Nothing on them is
worth a crawl, and `/verify-email` carries a single-use credential in its query
string.

### Named gaps

- **`/` resolves now**, and so do the category landing pages. Both were named as
  gaps here: the sitemap emitted `/` before it existed, on the argument that it
  encodes the platform's public URL contract (§4.4, §10.2) rather than an
  inventory of the routes that happen to be built — which is exactly why neither
  the campaign entries (#119) nor this one needed changing when the page landed.
  The category gap read "the only URL reaching one is `/discover?category=games`,
  which `Disallow: /discover?` blocks, and a sitemap must never advertise a URL
  robots.txt blocks"; #265 built the path-based route that closes it.
- **The campaign list is walked, not counted.** There is no endpoint that returns
  a count or a bare list of public project URLs, so the sitemap pages through
  `GET /v1/discover` at `limit=100` — bounded at 500 pages, or 50,000 campaigns —
  and memoises the walk for fifteen minutes. Past that bound the walk is the
  wrong shape and the service needs an endpoint built for it.
- **The sitemap reads the service directly rather than through `publicFetch`.**
  `lib/api/client.ts` issues a same-origin *relative* request, which is what
  makes the `SameSite=Strict` refresh cookie work in a browser and what makes it
  unresolvable in Node, and it attaches an in-memory access token that must never
  ride on a crawl-facing read. The sitemap resolves `/v1/discover` against
  `IDEANEST_API_ORIGIN` — the same variable the proxy uses — and imports its
  response types from `lib/discovery/api.ts` rather than restating them.

## The checkout

`/projects/[id]/back` is the pledge flow of `docs/architecture.md` §4.5 — PL-01
to PL-08 and PL-12. The segment is `back` because that is the reader's word for
what they are doing; `checkout` is ours for the machinery, and it borrows a
shopping cart's model, which is wrong here in a way that matters: nothing is
bought and nothing is charged.

**Three steps, one route, and no query string.** Unlike `/discover`, the state
here is React state. A half-made pledge is not a thing to link to, and a
reservation lives five minutes — a back button that could re-enter the review
step would routinely land on a hold that has gone. The one parameter the route
reads is PL-15's `?token=`, repeatable, which unlocks secret tiers.

| Module | Holds |
|---|---|
| `lib/pledges/api.ts` | The public reward list, the draft, the read, and the confirm |
| `lib/pledges/quote.ts` | PL-06's total, mirroring `PledgeQuote` in `pledge/domain` |
| `lib/pledges/idempotency.ts` | What "the same intent" means, and when a key is retired |
| `lib/pledges/failure.ts` | Each contract refusal, with the recovery that belongs to it |
| `components/checkout/useCheckout.ts` | The selection, the two requests, and the phase |
| `components/checkout/useReservationClock.ts` | PL-13's five minutes, counted down and not animated |

**Two totals, and only one of them is true.** The client quotes the selection
with `decimal.js` so the figure moves as the backer chooses. The moment a draft
comes back, `PledgeResponse.amounts` replaces it outright — the two are never
merged and never shown together. The server prices the row it is about to
reserve, inside the transaction that reserves it; the client is pricing a list it
fetched some seconds ago.

**The idempotency key belongs to an intent, not to an attempt.** A key is issued
per request body, so a retry after a dropped connection sends the same key and is
answered with the same pledge rather than creating a second one. It is retired in
exactly two cases: a reservation that expired — where the body is identical but
the intent is new, and replaying would hand back the draft that just expired —
and a key the service has told us is spent. Going back to change the selection
does **not** retire it, because a backer who changes nothing should get their
existing reservation and its existing clock.

**A collision with your own first attempt is waited out, not reported.** `409
IDEMPOTENT_REQUEST_IN_PROGRESS` is what a double-click produces: the first
request still holds the claim on the key, and the second is told to ask again.
The backer can do nothing about it and their pledge is already being made, so
`useCheckout` waits the `Retry-After` the response carries and sends the **same
key** again — capped at five seconds a wait and three retries, after which the
message says what happened and offers the button. A fresh key on that retry
would be the second pledge this whole mechanism exists to prevent.

| Refusal | What the checkout does |
|---|---|
| `IDEMPOTENT_REQUEST_IN_PROGRESS` | Waits `Retry-After` and re-sends, same key, bounded |
| `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID` | Says it is a fault in this page. Neither can happen while `idempotency.ts` sends a `crypto.randomUUID()`, so reaching one is a bug report and not a state a backer can recover from |
| `PLEDGE_MODIFIED` | Offers a new reservation. Usually §8.4's sweep expiring the draft as it was confirmed — the service will not claim a cause it inferred rather than observed, and neither does the wording |

**The confirmation reads the pledge rather than asserting facts about it.**
`cardVerified` and `paymentMethodId` come back on every `PledgeResponse`, and
the "what happens now" sentences are written from them. Both say the same thing
today as the hard-coded prose they replaced — nothing charged, no method
collected — and #55 is precisely the change that would have made that prose a
lie nobody was told to go and fix.

**There is no card form, and adding one would be a defect.** Card entry and 3-D
Secure are #55, blocked on #60 (`status: needs-decision`), so there is no
provider, no hosted field and nothing to tokenise with. `§17.2` targets SAQ A,
which holds only while card data never touches our servers — and a field that
looks like it takes a card teaches somebody that this is where a card goes on
this site. The payment step is an honest note saying nothing is collected, and
`paymentMethodId` is sent as null.

**Confirmation is a commitment, not a payment.** §9.2 collects nothing until the
campaign succeeds, and this build has not even taken a card, so the confirmation
screen says both in as many words.

**Tax is `0.00` and the line is not printed.** `TaxPolicy` holds the zero
deliberately until #78. A permanent "Tax 0.00" row invites the one question the
interface cannot answer; the line appears by itself the day the policy stops
answering zero.

## The campaign editor

The editor is one shell (`src/components/campaign-editor/EditorShell.tsx`) and
one tab per route. `src/components/campaign-editor/tabs.ts` is the only place a
tab is declared: the shell renders that list, and a section whose route does not
exist yet is a **disabled tab rather than a stub page**. A stub cannot be told
apart from a broken page, and the file it would need belongs to the issue that
builds it. Adding a section is a row in `tabs.ts` plus the route it points at.

Every section in `EDITOR_TABS` now has its route, so nothing is currently marked
unavailable. The mechanism stays because `docs/architecture.md` §4.6 describes
three sections that are still unbuilt — people, account, and promotion — and each
of them will be a disabled tab before it is a page.

### The pre-launch tab

It edits the campaign's `title`, `blurb`, and `coverImage` through the same
autosave path the basics tab uses, and not through fields of its own. A dedicated
pre-launch headline would let a creator promise one thing on the page people
follow and something else on the campaign it becomes, and the follower signed up
for the first.

Opening the page is behind a dialog rather than a switch: it publishes the
campaign at a public link, and `docs/architecture.md` §6.1 has no
`PRELAUNCH → DRAFT` edge, so there is no undo to offer afterwards.

### The review tab

`ReviewPanel` reads `GET /v1/projects/{id}/checklist` and renders three things:
the itemised completeness checklist, the last moderation decision, and the submit
control.

**The server is the authority.** The checklist is read when the tab opens;
`POST /submit` re-checks the same rules server-side with the same class. When it
refuses with `PROJECT_NOT_SUBMITTABLE`, the requirements *it* named replace what
the screen was showing — a field may have been emptied by a collaborator since, or
the deployment may enforce a rule this build has never heard of. There is
deliberately no client-side copy of §5.3 here; unlike the basics tab, nothing on
this screen is being typed, so there is nothing an immediate local answer would
buy that a second disagreeing implementation would not cost.

**Blocking and advisory never share a presentation.** Two headed groups, two icon
shapes, and every row states "Done", "Required, not done", or "Recommended, not
done" in text. The score is a sentence with counts — `83% complete. 10 of 10
required items done, 0 of 4 recommended.` — and the bar beside it is
`aria-hidden`, because it is a picture of a number the sentence already carries.

### Autosave

There is no save button below the basics tab. `useAutosave` debounces, keeps a
single request in flight, and only clears its pending patch on a **successful**
response — so a retry after a failure sends the same body rather than an empty
one, and nothing typed is lost. `SaveStatus` reports saving, saved, or not saved,
and announces only the outcomes.

### What the basics tab cannot do yet

| Missing | Why |
|---|---|
| Location | `projects` has no `location_id` and there is no geocoding service. `docs/architecture.md` §7.2 holds both for the discovery epic |
| Uploading a cover image | There is no media table and no uploader. The cover is a URL plus the width and height read in the browser; the media pipeline (§13) replaces all three |
| Video | Same media pipeline, and no client-side equivalent of reading an image's intrinsic size |
| Changing the category | Needs `GET /v1/categories`, which no sub-issue of the editor epic owns. The field degrades to a notice and everything else still saves |

## How authentication works here

The access token lives in a module variable in `src/lib/api/access-token.ts` and
nowhere else. It is a fifteen-minute bearer credential — `localStorage` would
hand it to any script that ever runs on the page and outlive the tab for no
benefit. The durable half of the session is the refresh cookie, which script
cannot read by design.

`authorizedFetch` attaches the token, and on a `401` refreshes once and retries
once. Refresh is single-flight: refresh tokens rotate on use and a reused one is
treated as stolen, so two concurrent refreshes would end the session family
between them.

**The two helpers cache differently, and neither serves a stale body.**
`authorizedFetch` sends `cache: 'no-store'`: an account read carries no validator
to revalidate against, so storing the response buys nothing and a stale device
list on a security screen is the one thing that page must never show.
`publicFetch` sends `cache: 'no-cache'`, which still forces a revalidation on
every single request but lets that revalidation be conditional. Public reads
carry `ETag` and `Cache-Control` per `docs/architecture.md` §10.3 — the reward
list is `private, no-cache` — so an unchanged list is answered `304` with no body
instead of re-sending every tier, item and shipping rule on each poll of a live
stock count. `no-store` here would make that `304` unreachable, which is what
#200 fixed.

### The second factor, and the two provider buttons

`POST /v1/auth/login` and `POST /v1/auth/oauth/{provider}` are answered by the same
`respondTo` on the service, so **either can return a two-factor challenge instead of a
session**. `useSignInOutcome` is the one place that branch is taken, shared by the password
form and both provider buttons on both `/sign-in` and `/register`; a component that handled it
in one place and forgot it in another would not fail loudly, it would call `refresh()`, find no
session, and leave somebody on a form that appeared to do nothing.

The provider SDKs are fetched **on the first interaction**, not on render: together they are a
couple of hundred kilobytes of third-party JavaScript that most visitors to a sign-in page
never use, and the two screens they sit on take the minimal shell for the same reason.
`src/lib/auth/script.ts` owns the loading.

Google's own button is rendered rather than one of ours, and the asymmetry is theirs: Google
Identity Services no longer offers a reliable way to raise a credential prompt from a click —
One Tap is browser-arbitrated through FedCM and is suppressed after a dismissal — so
`renderButton` is the supported path for a custom sign-in surface. Apple exposes
`AppleID.auth.signIn()`, a promise a click can call, so Apple gets an ordinary `Pill`.

### Named gaps in the account area

| Gap | What it costs | Whose it is |
|---|---|---|
| `GET /v1/me` carries no `twoFactorEnabled` | `/settings/security` cannot say whether two-factor is already on. It offers both paths and lets `POST /2fa/enable` answer — the service refuses an enrolled account with a sentence written for its owner, and the panel moves to the off-path on it | §17, not this epic |
| No `PATCH /v1/me` | The profile editor (#276) has nowhere to save, so there is no entry for it in the account navigation | The user module |
| `GET /v1/users/{slug}` carries no counts | The profile's two tabs cannot print "12 campaigns" above a list; they print the list. Answering the counts inside the user module would give the module every other module depends on a dependency on `project` and `pledge` in turn, and a `total` on each list would sit above a shorter one on the backed tab, which drops what the reader may not see | Decided, not a gap — `PublicProfiles` carries the argument |
| No creator biography beyond `users.bio` | The Creator tab (#282) has a bio, an avatar and the campaigns this account has launched. §4.4 also asks for history and contact, and there is no column for either | The user module |
| A suspended account still has a public profile | §4.11's AD-04 stops an account and does not retract the campaigns it launched, so withdrawing the index while publishing everything it indexes would be a half-measure. Whether a suspension should hide the profile is a product question nobody has been asked | Needs a decision |

Three rows left this table when #271, #274 and #287 landed: `GET /v1/users/{slug}`,
`POST /v1/auth/forgot-password` and `GET /v1/me/pledges` are all built. What they
unblocked is in the sections above.

## Real user monitoring

`src/lib/rum/` measures LCP, INP, CLS, TTFB and FCP on real devices and posts
them to `POST /api/rum` (#128). `docs/observability/real-user-monitoring.md` is
the full account — the thresholds, the sampling reasoning, the privacy rules,
what a production sink would have to be, and the named gaps. The short version:

**Field, not lab.** `apps/web/performance/` measures Core Web Vitals in
Lighthouse on a CI runner; this measures them on the devices people actually
use. Both use Google's published good/needs-improvement boundaries, and
`src/lib/rum/metrics.test.ts` reads `performance/summarise-lighthouse.mjs` and
fails if the two stop agreeing. INP appears only here — a headless load performs
no interaction, so no lab tool can report one.

**p75, nearest rank**, because that is how Core Web Vitals is defined and
because an interpolated percentile is a headline figure no session experienced.

**Nothing that identifies a person.** No URL — a Next route pattern from a fixed
whitelist, so a campaign identifier and a search term cannot leave the browser.
No query string, no account, no user agent, no stored IP address, and no field a
free string can enter. Two locks: the schema refuses unknown keys and validates
every value against a closed vocabulary, and §17.4's shape rules then run over
what is left.

**Session-consistent sampling**, defaulting to every session, because a p75 over
a few hundred samples moves by more between two ordinary days than a regression
would move it — and there is no production traffic to sample down from yet. A
coin flip per metric would rank metrics rather than visits and produce something
with the shape of a p75 that is not one.

**`sendBeacon`, falling back to `fetch(…, { keepalive: true })`.** The metrics
worth having are final only as the page goes away, which is exactly when a
browser cancels requests. Reporting a metric does nothing but push onto an
array; the send happens in an idle callback, or synchronously on `pagehide`.
`<WebVitals />` renders `null`, so there is no element, no motion, and nothing
that could shift the layout it is measuring.

**It joins the server's traces.** `instrumentation-client.ts` puts the session's
W3C `traceparent` on every same-origin `/v1` request, using the identifiers
`docs/architecture.md` §18.1 already defines, so a slow field session and its
server spans share a `traceId`. It never overwrites a header a caller set, so
the day `lib/api/client.ts` does this itself, this stops.

**No analytics vendor is introduced.** Accepted samples become one JSON line per
sample on stdout, beside the application's other lines. §14.2 lists product
analytics as a choice not yet made, and it stays not yet made.

```bash
pnpm --filter @ideanest/web dev
curl http://localhost:3000/api/rum        # the p75 table, in development
```

## Styling

`src/app/globals.css` imports `@ideanest/ui/styles.css` and nothing else. That
one import brings Tailwind, the token file, and the theme bridge, so this
application defines no colour of its own — see `docs/ui-kit.md` §10.1, where a
test fails the build on a colour literal.

### Fonts

`src/app/layout.tsx` loads Inter through `next/font/google` and binds it to
`--font-inter` on `<html>`; the theme bridge in `@ideanest/ui/styles.css` reads
that variable for `--font-sans` and `--font-display`. Next self-hosts the files
out of `/_next/static/media`, so there is no request to a third origin and no
blocking round trip before the browser learns which `.woff2` to fetch.

**Only `latin` and `latin-ext` are declared, and both are needed.** Google's
`latin` cut carries `ı`, `ö`, `ü` and `ç`, but `ə` (U+0259), `Ə`, `ğ`, `Ğ`, `ş`,
`Ş` and `İ` live in `U+0100-02BA`, which only `latin-ext` declares. A missing `ə`
is a broken product in this market, so `src/app/font-subsets.test.ts` fails if
the list stops covering those code points, and fails again if one of the
`cyrillic`, `greek` or `vietnamese` cuts is added — each one is another file
preloaded against the largest contentful paint.

Those two are the **only** preloads on the page. They earn it: every glyph above
the fold is set in this family. `adjustFontFallback` is left at its default, so
Next synthesises a metric-matched local fallback and the `display: 'swap'` does
not move the layout — which is what keeps cumulative layout shift inside the
0.05 `docs/motion-system.md` §8 asks for.

Weight is the full variable axis rather than the four weights `docs/ui-kit.md`
§5.3 names. Google serves Inter v20 as a variable file either way: asking for
`wght@400;500;600;700` returns the same two subset files 380 bytes smaller, so
pinning would buy nothing and would break the first `font-bold` somebody adds.

`--font-display` still asks for General Sans first, which `docs/ui-kit.md` §5.1
makes the first choice for display and headings. It is a Fontshare licence and a
vendored binary rather than a build-time download, so until somebody makes that
call the stack resolves to Inter — the substitution §5.1 names itself.
