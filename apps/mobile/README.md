# `@ideanest/mobile`

The React Native application — `docs/architecture.md` §14.3.

```bash
pnpm --filter @ideanest/mobile typecheck
pnpm --filter @ideanest/mobile test
pnpm --filter @ideanest/mobile start   # a development build, not Expo Go
```

## What it is

| Concern | Choice |
|---|---|
| Toolchain | **Expo SDK 57**, React Native 0.86, React 19.2 |
| Navigation | **Expo Router**, file-based, under `src/app/` |
| Styling | `StyleSheet` over `@ideanest/design-tokens` — see below |
| Server state | **TanStack Query 5**, persisted to MMKV |
| Storage | **MMKV** for the cache, the platform keychain for the session |
| Lists | **FlashList** |
| Animation | **Reanimated 4** |
| Push | **Expo notifications** |
| Session | Refresh token in the keychain, behind an optional biometric gate (§4.12 MB-03) |
| Tests | **jest-expo** — the one package in this repository not on vitest |

## Where it differs from §14.3, and why

**Expo SDK 57 and React Native 0.86, not SDK 52 and 0.76.** §14.3 was written when
52 was current. 52 reached end of life in 2025, its React is 18, and the New
Architecture it describes as a choice is no longer optional. Starting a new
application on it would be starting it two years behind. `docs/architecture.md`
carries the same note.

**No NativeWind.** §14.3 names NativeWind 4, which drives Tailwind 3. This
repository is on Tailwind 4 everywhere — `apps/web` and `packages/ui` both — and
NativeWind's Tailwind 4 release is `5.0.0-preview`. The two available options
were a second, older Tailwind major with its own config dialect living beside
the current one, or a preview dependency underneath every screen in a new
application.

Neither buys anything `StyleSheet` over the tokens does not: the values are
identical either way, and the class names would be a second spelling of them
rather than a second source. `src/theme/index.ts` carries the argument in full,
and `src/theme/theme.test.ts` enforces the part that actually matters — **no
colour anywhere in `src/` that is not a token**, which is the same guard
`packages/ui` runs over its own source.

Revisit when `nativewind@5` is stable. The revisit is cheap because the screens
import the tokens rather than class names.

**Jest, not vitest.** Every other workspace runs vitest and that is still the
right default. React Native ships untranspiled source with Flow annotations, and
the transform that strips them is `babel-preset-expo` — the same one Metro uses.
A runner that does not go through Babel stops at the first import of the
framework. `jest.config.js` explains the two settings that make this work under
pnpm's non-flat `node_modules`.

**A custom entry, `index.ts`, for `Intl.PluralRules`.** `package.json`'s `main` is
`index.ts`, which imports `src/lib/intl-polyfill.ts` and then `expo-router/entry`.
Hermes ships without `Intl.PluralRules` (and without `Intl.Locale`) on Android and
iOS, so every ICU `{count, plural, …}` message failed in `intl-messageformat` and
`use-intl` printed its key — a release APK showed `campaign.daysLeft` on a campaign
card (#155). The polyfill is `@formatjs/intl-pluralrules`, installed only when the
engine lacks the constructor, with CLDR data for `en`, `az`, `ru` and `tr` and no
other language. It runs from the entry rather than the root layout because any
module Expo Router loads may translate at import time, and the entry is the one
place that is first for all of them. `@ideanest/messages`' `pluralForm` asks with
`localeMatcher: 'lookup'`, so `en-GB` resolves to `en` without `Intl.Locale`.
Jest runs on Node, which has both constructors; `src/lib/intl-polyfill.test.ts`
deletes them to show the bug and the fix.

**The same entry installs `Intl.DisplayNames`.** Hermes lacks it too, so
`regionNames` in `@ideanest/messages/formats` returned nothing and every country
picker (checkout, the pledge editor, the shipping address) listed bare ISO codes
on a device. The polyfill is `@formatjs/intl-displaynames`, pinned like the plural
rules, installed only when the engine lacks a working constructor, with CLDR data
for `en`, `az`, `ru` and `tr` only. `regionNames` asks with
`localeMatcher: 'lookup'` for the reason `pluralForm` does: the app's English is
`en-GB`, and the default "best fit" matcher reaches for `Intl.Locale` to resolve a
tag it holds no data for, which Hermes does not have. Adding `@formatjs/intl-locale`
would also work, at the cost of another polyfill on every launch. The Metro export
in `mobile-check.yml` bundles it from `index.ts` like the plural rules, and
`src/lib/intl-polyfill.test.ts` deletes `Intl.DisplayNames` to show both the bare
codes and the localised names.

## The UI kit (#151)

`@ideanest/ui` is React DOM, so the app has its own half of the same design in
`src/components/ui/`, one component per file, imported from
`src/components/ui/index.ts`. Screens build from the kit rather than from
`react-native` primitives, for the web's reason: a second button is how a second
design starts.

- **Typeface.** Inter in three weights, embedded at build time by the
  `expo-font` plugin (`app.config.ts`), never loaded at startup.
  `src/theme/fonts.test.ts` reads the font files and checks the names each
  platform looks a face up by, and the ə, ğ, ş, İ and Cyrillic glyphs.
- **Surfaces.** A lime or white container provides a `SurfaceProvider`, and every
  text role and ghost icon under it switches to the on-lime or on-white tone —
  the native `data-on-lime`. `theme.test.ts` measures every tone on every
  surface it can land on.
- **White is primary, lime is accent.** `Pill`'s `primary` is white, and
  near-black under a white surface so it keeps an edge; `danger` is near-black
  on red, because white there is 3.4:1. `accent` is
  the one urgent action on a screen and warns in development when a screen
  mounts two. Lime is never text: `theme.test.ts` fails on a lime text colour.
- **Motion budget.** A route declares `MotionBudgetProvider level=…` from
  `docs/motion-system.md` §5 (checkout, the editor, auth and settings are
  `none`); every animated primitive asks `useMotionAllowed`, which also says no
  when the device has Reduce Motion on. Undeclared screens get `minimal`.
- **Feedback without toasts.** `announce()` is the native `aria-live`, and
  `haptics` is exactly the five events in §7's table.
- **Every screen is on the kit.** The app's first ad-hoc components are gone:
  `components/form.tsx` (`Button`, `TextField`), `components/states.tsx`
  (`Loading`, `EmptyState`, `ErrorState`, `OfflineNotice`), `components/avatar.tsx`
  and the `components/progress.tsx` re-export. Their replacements are `Pill`,
  `Field` with `TextInput`/`PasswordInput`/`Textarea`, the skeletons,
  `EmptyState`/`ErrorState` (retry required), `InlineAlert`, `Screen`, `Avatar`
  and `ProgressBar`, all from `components/ui`. The order of a list screen's
  states — cached data, then the error, then empty — lives in `Screen`.
- **The gallery.** `src/app/dev/kit.tsx` (open `ideanest://dev/kit` in a
  development build) shows every component in every variant, size and state,
  grouped as the barrel is, to hold beside the web's Storybook. Expo Router's
  own linking can route a link to it in any build, so the guard is the route
  itself: it renders only when `__DEV__` is true and redirects to `+not-found`
  otherwise. The app's deep-link parser never names it as a destination
  (`links.test.ts`). It has no words of
  its own: headings are component names read from the code, and every sentence
  is a catalogue key, so it also shows the kit in Azerbaijani and Russian.

## Discovery (#153)

`src/app/discover.tsx` is the web's `/discover`. Its filters, query and sort
are **the route's params**, under the service's own names, parsed and written by
`@ideanest/discovery` (`packages/discovery`), the same module the web uses.
`/discover?category=games&sort=ending_soon` is therefore the same feed on both.

- A change is `router.setParams`, which replaces the params rather than pushing
  another screen. Back leaves Discover; it does not walk through filter states.
- Read a link with `searchParamsFrom`, never with `new URLSearchParams(...)`.
  React Native's constructor misreads `?tag`, `?q=a=b` and a stray `%`; see
  `packages/discovery/README.md`.
- The filters sit in a sheet (`components/discovery/filter-sheet.tsx`) and apply
  as they are ticked. Only the two custom money ranges have an Apply button.
- Pages are 24 cards, as on the web. The list asks for the next page about half
  a screen before the end, and "Show more projects" is the same request. A
  cursor is asked for once per filter set, so after a failure only the button
  retries.
- The card (`components/project-card.tsx`) is the web card field by field. It
  is one link, and what it prints is its accessibility value.

## Categories and collections (#154)

Five routes, each at the web's path: `categories`, `categories/[category]`,
`categories/[category]/[subcategory]`, `collections` and `collections/[slug]`.
The screens are in `src/components/browse/`; the slug lookups, the wire
narrowing and a collection's window are `@ideanest/discovery/taxonomy` and
`@ideanest/discovery/collections`, the modules the web reads too.

- A breadcrumb sits above each landing's heading. A link opens these screens
  with no back stack, and the trail is the way up.
- A category landing shows 24 cards and hands off to Discover with the filter
  applied, as the web does. A collection pages in place, in the curator's
  order: by itself near the end of the list, and with "Show more", which is
  disabled while a page loads. A cursor is asked for once.
- A slug that names nothing, and a collection the service answers 404 for, is
  `NotFoundState`. A read that failed is an error with retry, where the web
  can only say "nothing here".
- Collection dates are long dates in UTC (`formatWindowDate`), so a window
  closing at 23:30 UTC on the 31st reads the 31st on every phone.
- The taxonomy and collections are cached for the session, never persisted.

## The pre-launch page (#155)

`campaigns/[id]/prelaunch`, the web's `/projects/{id}/prelaunch` (`PrelaunchView`).
The screen is `src/components/prelaunch/`; its rules — the web's address check,
the reminder write and the failure wording — are `src/lib/prelaunch.ts`.

- Public. A guest types an address; a signed-in reader is shown none and the
  request goes with `{}`, registered against the account.
- `GET /v1/projects/{id}/prelaunch` sits under the persisted `project` root, so
  the page opens offline with a notice, the form disabled and the reason given.
- A 404 is "nothing to see here", whichever of no campaign, a draft or launched
  it was. `REMINDERS_CLOSED` (the campaign opened while the page was open) goes
  to the same state with "already opened". Anything else is an error with retry.
- A 429 names the wait in whole minutes, rounded up from `retryAfterSeconds`.
  A failed reminder otherwise says it could not be saved, except a 401 — or a
  400 to the account's `{}`, which means the bearer was lost to a dismissed
  prompt or a failed refresh — which asks the reader to sign in again. A failed
  read shows the service's `detail` (then `title`), as the web does.
- `REMINDERS_CLOSED` also drops the persisted page, so an offline cold start
  cannot show "Coming soon" again; a pull that finds the page again leaves it.
- One `FadeUp`, on the cover, title and count; the form is outside it. The one
  lime control is "Remind me".

## The campaign page (#155)

`projects/[creatorSlug]/[projectSlug]`, the web's `/projects/{creatorSlug}/{projectSlug}`.
The screen is `src/components/campaign/campaign-screen.tsx`; the page's rules (states,
pledgeability, the 80% threshold, the countdown, the story schema, the realtime wire format)
are `@ideanest/campaign`'s, the same functions the web calls.

- **One `FlatList`.** Blocks 1–10 (cover, tags, title, byline, funding, countdown, Back,
  Save/Share/Remind, trust, update obligation) are its header; the tab bar is its sticky
  first row; the active tab's rows are its body; the rewards and the report link are its
  footer, on every tab. Switching tabs never remounts the header.
- **Tabs are hooks** (`src/components/campaign/tabs/contract.ts`): each of
  `campaign-tab`, `creator-tab`, `faq-tab`, `updates-tab` and `comments-tab` exports a
  `use…Tab(context)` that hands the list its rows, a footer, an end-reached handler (pages
  append), a refresh and a loading flag, calls its hooks on every render and reads nothing
  while it is not the active tab. The screen calls the end-reached handler near the end of
  the tab's rows — not of the list, whose end is the rewards — once per list height.
  `?tab=` mirrors the selection (`router.setParams`; the default is left out), and an
  unknown value is the Campaign tab. All five are drawn in the app; none sends the reader
  to the web page.
- **Campaign** (`tabs/campaign-tab.tsx`): how a closed campaign ended, the story (the
  version-1 document from `@ideanest/campaign/story`, drawn as native text; an invalid one
  draws nothing, an embed opens outside the app) and the risks — everything from the page's
  own read, so the tab reads nothing of its own.
- **Creator, FAQ and Updates** (`tabs/creator/`, `tabs/faq/`, `tabs/updates/`) read only
  once their tab opens, and **as nobody** (`publicApi()` in `src/api/client.ts`, no
  `Authorization`), as the web does: the service shows a campaign's team updates and FAQ
  the public cannot see, and the page and its offline copy are the public's. Creator reads `GET /v1/users/{slug}` and seven of the creator's
  campaigns (six shown, this one left out) under the unpersisted `profile` root; a refused
  profile is the campaign's own name and avatar, with no link. FAQ is every answer open, no
  accordion. Updates page by 20 on the numeric cursor and **append**: the end of the list and
  a visible "Older updates" pill both ask for the next page, never the same cursor twice; a
  failed next page keeps the loaded cards and offers "Try again". TanStack's own refetches
  (mount, focus, reconnect), which would re-read every loaded page, are off; pull to refresh,
  and opening the tab on a stale list, read the first page alone and replace the loaded
  pages only once it has arrived.
- **Comments** (`tabs/comments-tab.tsx`, `tabs/comments/*`, `src/lib/comments.ts`): read
  **as nobody** too (`publicApi()`) — the service gives every caller the same page — and
  never persisted (the `comments` root). The composer sits above the threads (a sign-in card
  when signed out); pages of ten append by opaque cursor — the end of the list and an "Older
  comments" pill, never the same cursor twice, and a page asked for during a re-read is made
  once it settles. Reply where the service says `acceptsReplies`, Withdraw for the author
  only (the account id from `GET /v1/me`, confirmed in place, focus moved to the warning), a
  tombstone for a withdrawn comment, and "Report this comment". "Show more replies" sets
  `?thread=` for the single-thread view: that conversation alone, no composer, its replies
  paged with the thread's own cursor. Every write invalidates all of the campaign's comment
  views; a new comment and pull to refresh read the first page alone, a reply or a
  withdrawal every page shown.
- **Report** (`report-link.tsx`, `report-sheet.tsx`, `src/lib/report.ts`): block 14's link
  and each comment's open the kit's `Sheet` — the nine reasons from
  `@ideanest/campaign/report` named by `admin.moderation.reason.*`, a detail capped at 2000
  and required for Other, a sign-in invitation when signed out, and the acknowledgement in
  place of the form once filed.
- **Back this campaign** and **Select this reward** are shown only where `acceptsPledges`
  is true, and push the app's `campaigns/[id]/back[?reward=]` (`checkoutHref` in
  `src/lib/campaign-actions.ts`), the native checkout (see "Checkout" below).
  The page's clock (`src/lib/campaign-clock.ts`) moves at the deadline and at each day
  boundary of a live campaign, so Back, the bar, Select, the days left and the "Last day"
  chip follow the time rather than the moment the screen opened. The pill is
  white; the only lime on the page is the two-days-left chip. A bar with the same pill is
  pinned under the list while the header's one is out of view; it has no animation and is
  hidden from screen readers, which meet the header's pill in reading order.
- **Save** starts "off" until #137 publishes the viewer's state; it toggles at once, rolls
  back on a refusal and refreshes the Saved tab on success. **Remind** is offered before
  launch only. Signed out, Save opens sign-in and Remind the pre-launch page.
- **Live funding** opens `IDEANEST_REALTIME_ORIGIN`'s socket only while the screen is
  focused, the app is in the foreground and the device is online
  (`src/lib/use-campaign-updates.ts`); frames are added with `decimal.js`. The countdown
  pauses in the background and is a `timer`, not a live region.
- **Dates** are the device's zone (`formatInstant`, `formatDay` in `src/lib/i18n.tsx`);
  the update obligation and the day a campaign closed are UTC days, as on the web.
- **States**: a 404, an unreadable response or a non-public state is the not-found
  screen; a failure with nothing cached is an error with retry; a cached page that could
  not be refreshed carries the offline notice, opens no socket and disables Save, Remind,
  posting, withdrawing and reporting with the reason. The page, rewards, FAQ, updates and obligation persist under
  `project`; comments (`comments`) and profiles (`profile`) never do. A query whose refresh
  failed is still written, as the success it last was (`holdsData` in `src/lib/offline.ts`),
  so a page opened offline survives the next restart.
- No entry animation anywhere on the page.

## Configuration

Three origins, read at **build** time by `app.config.ts` and surfaced through
`Constants.expoConfig.extra` (`src/api/config.ts` reads them back). All three are
the names `apps/web` already uses, so a deployment answers "where is the API"
once rather than twice.

| Variable | Meaning | Unset |
|---|---|---|
| `IDEANEST_API_ORIGIN` | Where the Spring Boot service listens | `http://localhost:8080` |
| `IDEANEST_SITE_URL` | The public origin whose links this application claims | `https://ideyanest.com` |
| `IDEANEST_REALTIME_ORIGIN` | Where the campaign page opens §12.1's live-counter socket (#155): `http(s)://` becomes `ws(s)://`, a `ws(s)://` origin is used as it is | **no socket** — the figures stay as the page read them |

A value that is set but unusable **throws the build** rather than falling back.
An unset variable is somebody running locally; `IDEANEST_SITE_URL=ideanest.az`
with no scheme is a misconfiguration that would otherwise ship a build pointing
at localhost. The realtime origin accepts `http`, `https`, `ws` and `wss`.

`eas.json` sets the first two per profile. `development` points at localhost,
`preview` at staging, `production` at production. **No profile sets
`IDEANEST_REALTIME_ORIGIN` yet**: whether production opens a socket, and to which
host, is the owner's decision (the web leaves it unset by default for the same
reason — `@ideanest/campaign/realtime` says why). There is no default host.

Two more decide which provider sign-ins a build offers (issue #152). Unset means
the button is not drawn, because the service would refuse the token:

| Variable | Meaning | The service needs |
|---|---|---|
| `IDEANEST_GOOGLE_IOS_CLIENT_ID` | Google's **iOS** OAuth client. It redirects to `az.ideanest.app:/oauthredirect`; prebuild registers the bundle identifier as a scheme already | the same value in `GOOGLE_CLIENT_IDS` |
| `IDEANEST_APPLE_SIGN_IN` | `true` keeps the Sign in with Apple entitlement and draws the button. Unset, `app.config.ts` removes the entitlement the autolinked `expo-apple-authentication` plugin would otherwise add to every build | `az.ideanest.app` in `APPLE_CLIENT_IDS`, and the capability on the App ID |

Google appears on iOS only when Apple does too: App Store guideline 4.8 requires
Sign in with Apple beside any other third-party sign-in.

They are not in `eas.json` yet: the Google client and the Apple capability are
created in the owners' Google Cloud and Apple Developer accounts, then set as EAS
environment variables.

## Deep links (§4.12 MB-02)

A campaign is at `/projects/<creator>/<campaign>` on the web and at the same path
here, so the link that opened the application and the route it lands on are one
string. Its `?tab=` (one of the four non-default tabs) and, on the Comments tab,
`?thread=` are kept; the rest of the query is dropped.

The pages the web keys by project id — `/projects/<uuid>/prelaunch`, `/back`,
`/edit`, `/dashboard` — open under `campaigns/<uuid>/…`, because Expo Router
cannot hold `projects/[id]` beside `projects/[creatorSlug]`. They are matched
with a strict UUID before the creator/slug pattern, and the checkout keeps
`?reward=` and every `?token=` (comma-joined in the route param). `/projects/alice/prelaunch` (not a UUID) opens the campaign slugged
`prelaunch`, where the web would show its pre-launch page for an id of `alice`
(#148).

The browse pages are claimed too (#154): `/categories` and `/collections`, and
everything under each (exactly, on both platforms). `links.ts` decodes a slug
once and hands it on as a route param; Expo Router then encodes it into the path
and decodes what the screen reads, so a slug carrying a literal `%XX` would not
survive the trip. The service's slugs are `[a-z0-9-]`, so none does today.
`/categories/a/b/c` is refused.

Three discovery paths are claimed as well (#153): `/` opens Home, `/discover?…`
opens Discover with the filters in the query string, and `/search?q=` opens
Search with the query. Each is an exact path, so `/discover/anything` stays the
browser's. Discover's params are rebuilt from the link through the shared
`parseFilters` rather than passed through, so a `utm_source` or an unknown status
never reaches the screen. `links.ts`, the Android intent filters in
`app.config.ts`, and the web's `association.ts` claim the same paths.

Three ways in — a push payload (`ideanest://…`), a shared https link, and a cold
start — all go through `src/lib/links.ts`, which **refuses** anything it does not
recognise. Expo Router can route an incoming URL by itself; what it cannot do is
refuse one, and on Android any application can send an implicit intent carrying a
URL.

The grant lives on the web side: `apps/web` serves
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from
`src/lib/mobile/association.ts`. Both need identifiers that only exist once an
application has been signed:

| Variable | Set on |
|---|---|
| `IDEANEST_IOS_APP_ID` | `apps/web` — `<team prefix>.az.ideanest.app` |
| `IDEANEST_ANDROID_PACKAGE` | `apps/web` — `az.ideanest.app` |
| `IDEANEST_ANDROID_SHA256_FINGERPRINTS` | `apps/web` — comma-separated, one per signing certificate |

Unconfigured serves **404**, deliberately: both platforms already expect that
from a site with no application and retry, whereas iOS caches a file with the
wrong identifier in it for up to a week.

`scripts/check-association.mjs` asserts that the two halves name the same
application. Nothing else does, and the failure they produce is silent — the file
is fetched, disagreed with, and links quietly stop opening the application.

## Push notifications (§4.12 MB-01, §12.2)

`src/lib/push.ts` asks for the permission **at the moment it means something**,
never on launch: on iOS a declined permission cannot be asked for again from
inside the application.

Registration is `POST /v1/me/devices` and sign-out is `DELETE /v1/me/devices`.
A token belongs to whoever signed in most recently and to nobody else — two
people can share a phone, and a registration that stayed with the first would
deliver the second person's pledge confirmations to somebody else's lock screen.

Tapping a notification goes through the same parser a shared link does, so the
two cannot drift into "works from a link, does nothing from a notification".

## Offline (§4.12 MB-04)

`src/lib/offline.ts` persists TanStack Query's own cache to MMKV, so the screens
never know: `useQuery` answers from the cache it already answers from, and the
only difference offline is that the background refetch fails.

**Saved campaigns, pledges and campaign pages survive a restart. Feeds and search
results do not** — a feed is a ranking computed at a moment, and restoring last
week's is worse than showing that the device is offline, because it looks
current.

`networkMode: 'offlineFirst'` is the setting the whole feature rests on. The
default pauses a query when the device reports no connection, so a cached
campaign would sit behind a spinner that never resolves.

## Maintenance (#214, docs/architecture.md §19.6)

**Only the maintenance problem opens the maintenance screen**: a `503` whose
`application/problem+json` body has `type: https://ideanest.az/problems/maintenance`,
read with `@ideanest/api-client/maintenance`. A bare `503`, and every other `5xx`, is an
ordinary error that the screen which made the request shows with its own retry. This
replaces #198's "any 503 is maintenance" rule, which existed only because the API had no
maintenance mode.

| Piece | Where |
|---|---|
| The trigger: every response through `sessionFetch` and the auth calls is checked, from a clone | `src/lib/maintenance.ts` |
| The screen: title and description from `shell.failure.pages.maintenance`, then "Back around {time}" or "no end announced"; the neutral `shell.maintenance.edge.*` wording when the proxy answered (`source: "edge"`) | `src/app/maintenance.tsx` |
| The poll: `GET /v1/status` without the session and with `no-store`; first ask after `Retry-After` clamped to 5 s – 5 min, then every 30 s; leaves on `operational` | `src/lib/platform-status.ts` |
| The planned-maintenance banner under the header, while `upcoming` is set and has not started; closed per window (keyed by `startsAt`) and remembered in MMKV | `src/components/maintenance-banner.tsx`, `src/lib/upcoming-maintenance.ts` |

The banner learns of a window from `GET /v1/status` on launch and on each return to the
foreground, at most once every ten minutes, and from the maintenance screen's own poll.
There is no timer while the app is open: a window is announced a day ahead by default,
so that is enough, and it keeps the request count at one per app open.

## Signing in, and the biometric lock (§17.1, §4.12 MB-03)

The authentication screens are one route group, `src/app/(auth)/`, which the root
presents as a modal with no tab bar (issue #152). Its only chrome is the wordmark,
which leaves to Home, and a close control. Nothing in it animates — §5 of
`docs/motion-system.md` gives authentication no motion — and its screens replace
one another rather than push, so the group is always one screen deep and closing
it closes all of it.

| What | Where |
|---|---|
| The frame: one column capped at `formMeasure` (the web's 26rem), the footer rule | `src/features/auth/auth-screen.tsx` |
| Sign-in: address, password with show/hide, refusals, the `password-changed` notice | `src/app/(auth)/sign-in.tsx`, `src/features/auth/sign-in-form.tsx` |
| The second factor: a code field, and a recovery-code field behind a disclosure, sent as `recoveryCode` — never as `code`, which the service reads only as a TOTP; one expiry timer, no countdown | `src/features/auth/two-factor-step.tsx` |
| One `settle()` for every sign-in path, so a provider cannot skip the second factor | `src/features/auth/use-sign-in-outcome.ts` |
| The web's `describeAuthFailure`: suspension withdraws the submit, a 429 says the wait, no body means unreachable | `src/lib/auth-failures.ts` |
| `returnTo`: the web's `?next=` sanitising, and every auth path refused as a destination | `src/lib/guard.ts` |
| Register: always "check your email", whatever the address — the service hides whether it had an account, so the screen does too | `src/app/(auth)/register.tsx`, `src/features/auth/register-form.tsx` |
| The reset request and confirm: mismatched passwords send nothing, a weak password keeps the unspent link, a dead link shows the service's sentence | `src/app/(auth)/reset-password/`, `src/features/auth/reset-*-form.tsx` |
| The emailed links — verify-email, the reset confirm, confirm-email-change: the token is taken off the route, a newer link replaces it, and each token is requested once per process — a second mount reads the first answer | `src/features/auth/link-token.ts`, `verify-email-view.tsx`, `email-change-view.tsx` |
| Google (iOS, a system browser session with PKCE) and Apple (iOS, the native sheet) under the forms, each with a fresh nonce in the form its token carries; every answer through the same `settle()` | `src/lib/providers.ts`, `src/features/auth/provider-buttons.tsx` |
| Google's button artwork — the one file allowed colour literals, held by the theme test to Google's seven | `src/features/auth/google-brand.ts` |

After a sign-in, push is re-registered only where notifications are already
allowed (`registerIfAllowed`): signing in never shows a permission prompt.

It asks for `tokenDelivery: "body"` — the shape §17.1 defines for a native client —
and the refresh token goes into the platform keychain. **Refresh is
single-flight**, which §17.1 requires of every client and which a phone tests
harder than a browser: six persisted queries refetch in the same tick when a
phone is unlocked, and two concurrent refreshes present the same rotated token,
which is indistinguishable from theft and revokes the session family.
`src/lib/auth.test.ts` drives twenty simultaneous callers and asserts one
request.

### The lock is the keychain's, not this application's

With it on, the refresh token lives in an entry written with
`requireAuthentication`, so **the operating system** refuses to return the bytes
until a prompt succeeds. Nothing in JavaScript can go around that, which is the
reason to prefer it to an `if`.

| Property | Why |
|---|---|
| Two entries, never one | An authenticated entry is generated against its own key and cannot share a `keychainService` with an unauthenticated one — Expo's own note says so. Turning the lock on is a **move**, ordered so that a failure half-way leaves a readable session rather than none |
| Presence is answered from MMKV | "Is anybody signed in" is asked by two tabs on mount. Answering it from the keychain would show a Face ID sheet to somebody who opened the Saved tab. The boolean is not a credential; the token is fetched only when a request needs one |
| A dismissed prompt is not a sign-out | "Not now" must not mean "sign in again". The session stays; only this attempt fails |
| Turning it off needs the prompt | Reading the token is what the prompt guards, so somebody holding a phone they did not unlock cannot remove the thing stopping them |
| It re-arms on resume | The access token lives in memory for fifteen minutes, so the gate alone would let a phone handed over inside that window through. `src/app/_layout.tsx` drops it after two minutes in the background — nothing is revoked, so being wrong costs one prompt |
| Signing out erases the offline cache | `saved` and `pledges` are one account's and are persisted to MMKV. The in-memory cache is cleared **and** the document removed, rather than waiting a second for the persister's throttle |

The switch is offered only when the device can honour it. A phone with a scanner
and nothing enrolled says so and points at the phone's settings, because a
switch that turns on and then fails looks like a lost session later.

The switch lives in `settings/security`, in an "On this phone" card under
two-factor authentication (`src/features/settings/app-lock.tsx`, issue #161):
it belongs to this phone, not to the account, so it works offline while the
two-factor actions above it wait for a connection. The Me tab's "This phone"
row leads there whenever the phone holds a session — signed in, or unknown
because the lock has not been unlocked — so a reader who no longer wants the
lock can always reach it.

### Two-factor enrolment on a phone

`src/features/settings/two-factor.tsx` is the web's `TwoFactorPanel`, with its
steps in a pure reducer (`two-factor-flow.ts`). The scan step adds what a phone
can do: "Open in your authenticator app" (`Linking.openURL` of the
`otpauth://` URI, offered only when `canOpenURL` says an app answers), a QR
code encoded on the device with `qrcode` and drawn with `react-native-svg`
(`authenticator-qr.tsx`; the URI carries the secret, so it is never sent to a
QR service), and the key with a Copy button. `canOpenURL` answers "no" for an
undeclared scheme, so `app.config.ts` declares `otpauth` in iOS
`LSApplicationQueriesSchemes` and in an Android `<queries>` intent. The
recovery codes live only in component state — never MMKV, never the query
cache. While a request is in flight or the codes are on screen, the screen
cannot be left: the iOS swipe and the header back are turned off and Android's
back button is consumed, as checkout does, because a confirmation that lands
after the reader has gone switches two-factor on with codes nobody saw.

**It cannot be verified in CI, and never will be.** Biometric enrolment needs a
real device; what the suite covers is the keychain choreography and the refusal
paths, with `expo-secure-store` and `expo-local-authentication` replaced by
doubles that can refuse.

## Builds and releases (§19.2)

`eas.json` has three profiles and `.github/workflows/mobile-release.yml` drives
them. It **builds** only on a manual dispatch, because a store build is a
deliberate act with a human behind it.

The **checks** — typecheck, tests, the Expo config resolving, and the association
identifiers agreeing — are `.github/workflows/mobile-check.yml`. `ci.yml` runs
them on every change to `apps/mobile` or `packages/**`, and `CI complete` fails
when they fail, so a red mobile test blocks the merge (#144). The release
workflow runs the same checks again before it builds.

Building needs Xcode and the Android SDK, which this repository does not own, so
the build runs on Expo's infrastructure and needs `EXPO_TOKEN` in the repository
secrets. Without it the workflow says so and stops rather than failing.

The Android submit goes to the `internal` track as a **draft**, which makes the
staged rollout a decision somebody takes in Play Console rather than a
consequence of a workflow finishing.

## Checkout

`campaigns/[id]/back` (#157) is a full-screen modal with no motion: choose → review → pay.
The rules are `@ideanest/checkout`'s, shared with the web: the preview quote on
`decimal.js`, the draft body, idempotency keys bound to the request body (minted by
`expo-crypto`, kept in memory), the refusal table, and `attemptWithRetry`. Money writes go
through `src/api/mutate.ts`, whose signature requires an `Idempotency-Key`; nothing is sent
offline and nothing is queued. `src/features/checkout/use-checkout.ts` is the web's state
machine; `checkout-screen.tsx` draws it.

**The payment return.** The API accepts only site-origin return addresses
(`docs/architecture.md` §9.4), so the app pays with
`https://<site>/{locale}/pledges/{id}?payment=returned|failed&via=app`. The web proxy answers
that address with a `303` to `ideanest://pledges/{id}?payment=…`, which ends
`WebBrowser.openAuthSessionAsync(redirectUrl, 'ideanest://pledges/{id}')`. A dismissed browser
reads the pledge once: anything but `DRAFT` goes to the pledge, otherwise step 2 stays with
the hold running and paying again replays the same key. Not yet exercised against the Epoint
sandbox (no merchant account); the provider only ever sees the site origin.

**The payout card return** (`settings/payout`, #161) is the same mechanism: the app asks for
`https://<site>/{locale}/settings/payout?card=returned|failed&via=app`, the proxy answers with
`ideanest://settings/payout?card=…`, and that ends
`WebBrowser.openAuthSessionAsync(redirectUrl, 'ideanest://settings/payout')`. After a return, or a
dismissed browser, the screen re-reads `GET /v1/me/payout-destination` every 3 s, at most 20 times,
until its `updatedAt` changes; only a return says it is waiting for the provider. The card number
is entered on the provider's page, never in the app.

## Uploading an image

`src/lib/media/upload.ts` (#161, reused by #162's cover) takes a local picture to a servable one:
`expo-image-manipulator` converts it to JPEG on the phone (an iPhone's HEIC is not something the
transcoder promises to read) and scales the longest edge to 2048, then `POST /v1/media/uploads`,
a native `File.upload` PUT to the presigned address carrying **only** the signed `Content-Type`
(never the bearer token), `POST /v1/media/{id}/complete`, and `GET /v1/media/{id}` every 700 ms
for up to 90 s. It reports `preparing`, `uploading` and `processing`, and fails with the service's
`code` (or `UPLOADS_UNAVAILABLE` for a 503 without one); the caller picks the words, from
`campaignEditor.cover.failures`. `settings/profile` saves the result as `avatarUrl` at once.

## Pledges

The Pledges tab (#158) pages `GET /v1/me/pledges` 24 at a time in an infinite query keyed
`['pledges', 'list']`, under the persisted root. It reads the first page again on pull and when
opened stale, and never re-reads every loaded page on its own. `pledges/[id]` reads
`GET /v1/pledges/{id}` under `['pledges', id]`, so a pledge opened once is readable offline;
writes are disabled offline and never queued. The rules — which states edit, raise or dispute,
what a payment or raise return means, the Merge-Patch diff — are `@ideanest/checkout/pledge` and
`/edit`, shared with the web.

**A payment return** is decided by `pledge.state`, never by `?payment=`: `COLLECTED` is paid, a
returned `DRAFT` re-reads every 3 s up to 20 times (paused in the background, stopped on leaving
the screen), anything else took nothing. The hint is read once and dropped from the route. The
campaign's name comes from the cached list or at most three list pages; a pledge whose campaign
cannot be named still renders. `pledges/[id]/address` is a web placeholder until its own pull
request.

## What is not built

**Google sign-in on Android.** The iOS flow cannot be used there: Google refuses
custom-scheme redirects for Android OAuth clients, and there is no https endpoint of
ours to redirect to. The native route, Credential Manager, has to put our nonce in
the token (the service has `require-nonce: true`), which the free Google Sign-In
library does not do. It needs a small native module and a device to check it on.
Apple has no Android SDK. Android offers email and password meanwhile (#241).

**Opening the emailed links in the app.** The screens exist and read the link's
`token`; claiming `/verify-email`, `/reset-password/confirm` and `/confirm-email-change`
(unprefixed and under `/{az|en|ru|tr}/`) in the association files and `lib/links.ts` is
#165's. Until then the links open the website, which does the same thing.

**Four of the campaign page's tabs and its report sheet.** Creator, FAQ, Updates and
Comments open the same tab on the campaign's web page, and "Report this campaign" is not
drawn yet; each is a file of its own under `src/components/campaign/` (see "The campaign
page" above) that the rest of #155 replaces.

**A device.** Nothing here has been run on one. The tests, the typecheck and the
Expo config resolution all pass; what they cannot cover is push delivery, the
universal-link grant, and store review, all three of which need signed builds and
credentials this repository does not hold.
