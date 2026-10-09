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
- **Design language.** The `mobile-design` skill
  (`.claude/skills/mobile-design/SKILL.md`) defines how the app looks and moves;
  CLAUDE.md points mobile work at it.
- **Motion.** Every surface moves, checkout included (the skill's §6; the web's
  per-surface budget does not apply here). The default budget is `full` and no
  route declares one; every animated primitive still asks `useMotionAllowed`,
  which says no when the device has Reduce Motion on. Springs come from
  `spring` in `src/theme`, press feedback from `PressableScale` /
  `usePressScale`, and `FadeUp` animates only the first screenful.
- **Navigation motion (#279).** Stack pushes use the native `ios_from_right`
  on both platforms: the incoming page slides in while the outgoing one shifts
  back and dims. A campaign card's cover flies to the campaign page's cover and
  back through `SharedTransition` (`useSharedSource` / `SharedTarget` under
  the root `SharedTransitionHost`), a measured overlay rather than Reanimated's
  shared element transitions, which did not work on this stack — the reasoning
  is in `src/components/ui/shared-transition.tsx`. Keep Reanimated's
  `ENABLE_SHARED_ELEMENT_TRANSITIONS` flag off. `CardStack` is the stack →
  column fan-out.
- **Checking an animation's cost.** On a release build (not a development
  one), run the animation ten times on a low-end Android device and on an
  iPhone, and confirm the UI thread holds the refresh rate and the JS thread
  drops no frames because of it. A release build has no Perf Monitor; on
  Android read the frame statistics instead: `adb shell dumpsys gfxinfo
  az.ideanest.app reset`, run the animation, then `adb shell dumpsys gfxinfo
  az.ideanest.app` for the janky-frame share and the percentiles. On iOS use
  Instruments' Animation Hitches. Write the devices and the result in the pull
  request.
  Also run `adb logcat -d | grep -c "synchronouslyUpdateUIProps failed"`: it must
  be 0. Each one was an exception thrown and logged with its stack on the UI
  thread, and hundreds per frame froze the app for seconds at launch.
- **Reanimated is patched** (`patches/react-native-reanimated@4.5.5.patch`, in
  `pnpm-workspace.yaml`). 4.5.5 on React Native 0.86 writes animated props
  straight to the native view whenever an event arrives during a draw — every
  SVG icon path sends one on its first draw — and throws for a view that is
  not mounted yet. The patch backports 4.7's check (`getViewExists` first, no
  stack trace): the props stay in the registry and reach the view with the
  next commit. Drop it when Reanimated is upgraded past 4.7.
- **Animated props skip the shadow tree on Android.** `apps/mobile/package.json`
  turns on Reanimated's `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS`. Without it,
  every animation frame committed the whole React tree and ran Yoga layout on
  the UI thread, which is what made a push stutter while its page mounted. With
  it, `transform` and `opacity` go straight to the native view. The flag cannot
  be on together with `ENABLE_SHARED_ELEMENT_TRANSITIONS` (the build refuses),
  which is one more reason that one stays off. It depends on the patch above:
  without it, the direct writes throw for views that are not mounted yet.
- **Icons.** Iconsax, generated into `src/icons/glyphs.ts` by
  `scripts/generate-icons.mjs` from the MIT-licensed source
  (`iconsax-react-native`, a devDependency the app never imports). Use them as
  `<Icon icon={Glyphs.Heart} variant="bulk" />`; to add one, add its name to the
  script and run `node scripts/generate-icons.mjs`.
- **Accent surfaces.** `accent.sun`, `accent.mint` and `accent.sky` from
  `src/theme` (`accent` in `@ideanest/design-tokens`), each with its own
  text token and glow. Surfaces for cards only; they carry no meaning.
- **Feedback without toasts.** `announce()` is the native `aria-live`, and
  `haptics` is exactly the events in §7's table (the tab bar's Create button, a
  keypad key and a committed swipe among them).
- **The floating tab bar (#276).** `src/components/tab-bar.tsx`: Home · Search ·
  [ + ] · Pledges · Me over the content, lifted above the bottom safe area. The
  centre is a button that starts a campaign (through sign-in when signed out),
  not a tab. Saved is a row of the Me hub and a stack route at `/saved`. Every
  tab screen pads its scrolling content with `useTabBarInset()`, which `Screen`
  applies by itself; it is zero outside the tab group. On Android the bar steps
  away while the keyboard is up.
- **The design-language primitives (#277, #278).** The white `Sheet` (rise on
  `spring.sheet`, velocity drag, the page behind scaled by `SheetHost` in the root
  layout; `surface="dark"` keeps the earlier panel for the overlays #282 has not
  moved), `SegmentedPill`, `HeroFigure`, `AvatarStack` and `SourceDot`,
  `AccentCard` with `IconButton variant="translucent"`, and `EdgeFade`. Every
  moving number goes through `AnimatedAmount`: a formatted string in, `enter`,
  `roll` or `count` (count once, then roll), the exact string as the last frame
  and as what a screen reader hears. The campaign page's funding figures count
  up on first view through `StatBlock motion="count"`.
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
  back on a refusal and refreshes the Saved list on success. **Remind** is offered before
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
| `IDEANEST_EAS_PROJECT_ID` | The EAS project: the update URL and the push-token project (see "Builds and releases") | updates off, no push token |

A value that is set but unusable **throws the build** rather than falling back.
An unset variable is somebody running locally; `IDEANEST_SITE_URL=ideanest.az`
with no scheme is a misconfiguration that would otherwise ship a build pointing
at localhost. The realtime origin accepts `http`, `https`, `ws` and `wss`.

`eas.json` sets the first two per profile. `development` points at the
developer's machine (see "Running against a local API" below), `preview` at
staging, `production` at production. **No profile sets
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

One more decides where a plan is chosen (#164):

| Variable | Meaning |
|---|---|
| `IDEANEST_IN_APP_PLAN_CHOICE` | `true` lets Pricing choose and cancel a plan in the app. Unset, the app shows the plans, the held plan and the fee terms, and sends the choice to the web page in the in-app browser. Leave it unset until the owner's store-billing decision is recorded (see Pricing below) |

They are not in `eas.json` yet: the Google client and the Apple capability are
created in the owners' Google Cloud and Apple Developer accounts, then set as EAS
environment variables.

Crash reporting (#165) is off unless a build is told where to send reports. See
"Crash reporting" below.

| Variable | Meaning | Unset |
|---|---|---|
| `IDEANEST_SENTRY_DSN` | The project DSN, `https://<public key>@<host>/<project id>`. Not a secret: it ships in the binary. Anything else throws the build. Set it as an EAS environment variable with **plain text** or **sensitive** visibility, never **secret**: `eas update` cannot read a secret variable, so the update would evaluate `app.config.ts` without the DSN, hash to a different fingerprint, and reach no build | **no crash reporting**: the SDK is never started, and the privacy manifest declares no diagnostics |
| `IDEANEST_SENTRY_ENVIRONMENT` | Overrides the event environment. Rarely needed: EAS sets `EAS_BUILD_PROFILE` (the profile, which is the channel) on its build workers, and the release workflow exports it before `eas update` as well | `EAS_BUILD_PROFILE`, else `development` |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (`SENTRY_URL` for GlitchTip) | The source-map and debug-symbol upload. For EAS builds: EAS environment variables, the token **secret** (only the native build steps read it, never `app.config.ts`). For OTA updates: the `mobile` GitHub environment, the token as a secret and the other three as variables | no upload, and **no failed build or update**: `app.config.ts` gates Sentry's build steps on the token, and the release workflow skips the update's upload |

## Deep links (§4.12 MB-02, #165)

**One table, three readers.** The paths a link may open the application at are
`@ideanest/links`' `CLAIMED_ROUTES` (`packages/links/README.md`): the home page,
Discover, Search, the browse pages, every `/projects/…` form, pledges, profiles,
the inbox, the account and settings pages, sign-in, registration and the three
emailed links, and the static, legal, pricing and maintenance pages. The web's
association file, the Android intent filters in `app.config.ts`, and the parser
behind `src/lib/links.ts` are all built from it, and
`scripts/check-association.mjs` fails a build whose intent filter has drifted
from it. A new path is a row in that table, not an edit here.

Every path is claimed **bare and under each locale** (`/az/…`, `/en/…`, `/ru/…`,
`/tr/…`): the site serves every page under its locale, which is the URL people
copy, while the API's emails and this application's share sheet send the bare
form. **Never claimed:** `/admin` (the console is not in the app), `/api`,
`/v1`, `/.well-known`, `/_next`, the robots and sitemap files, the icons, and
every `opengraph-image`. iOS reads the excludes first; Android cannot exclude, so
its list is an allowlist of exact paths and prefixes, none of them covering
`/admin`.

**The locale in a link is stripped and does not change the app's language.** The
language is the reader's own choice (#150); `/ru/projects/a/b` opens the campaign
in whatever language the app is set to.

A campaign is at `/projects/<creator>/<campaign>` on the web and at the same path
here. Its `?tab=` (one of the four non-default tabs) and, on the Comments tab,
`?thread=` are kept; the rest of the query is dropped. The pages the web keys by
project id — `/projects/<uuid>/prelaunch`, `/back`, `/edit`, `/dashboard` — open
under `campaigns/<uuid>/…`, because Expo Router cannot hold `projects/[id]` beside
`projects/[creatorSlug]`. They are matched with a strict UUID **before** the
creator/slug pattern, and the checkout keeps `?reward=` and every `?token=`.
`/projects/alice/prelaunch` (not a UUID) opens the campaign slugged `prelaunch`,
where the web would show its pre-launch page for an id of `alice` (#148). A bare
`/projects/<uuid>` — what old notification rows still carry — lands on the
not-found screen, because the web has no page there either.

Every route keeps only its own query keys (`CLAIMED_ROUTES[].query`): Discover's
filters (rebuilt through the shared `parseFilters`), `q`, `tab` and `thread`,
`reward` and `token` on the checkout, `payment` on a pledge, `card` on the payout
panel, `from` and `project` on Pricing, `token` on the emailed links, and `next`
on sign-in, which is read through the same parser and handed to the screen as
`returnTo` (refused when it names another site, an auth screen, or nothing the app
has). Slugs are decoded exactly once. A campaign's two slugs are then encoded
again into the route path, which Expo Router decodes once on the way to the
screen, so a slug holding `?` or `#` stays one segment — in the navigation and in
a `returnTo` built from it. The browse and profile routes pass their slugs as
params for the same reason.

### What happens to a link

`_layout.tsx` hands the launch URL (a cold start) and every later one (the app in
the background or open) to `listenForLinks`, which asks `incomingLink`:

| The link | What happens |
|---|---|
| A route the parser answers | Its screen opens |
| Our host, https, a path the parser refuses (an OG image under `/projects/`, a page this build has no screen for) | The same URL opens in the in-app browser (`expo-web-browser`) — never nothing |
| `ideanest://` with a path the parser refuses | The not-found screen |
| Any other host, `http:`, or not a URL | Ignored silently: any app can send an implicit intent |

Both the navigation and the in-app browser go through `openWhenAllowed`, so the
app lock and a maintenance window hold a link until they open.

**Deliberately not `+native-intent.tsx`.** #165 asked for the parser to run in
`redirectSystemPath`, so Expo Router routes the rewritten path itself. That hook
runs before the root layout exists, so a link it rewrote would be routed before
the app lock could hold it — the navigation bypass the lock's review warned
about (#321). It keeps answering `null` (Expo Router stays where it is), and
`_layout.tsx` routes every link through the lock. Expo Router therefore never routes an incoming URL on its
own, so a locale-prefixed link does not flash the not-found screen either.

**Emailed links** (`/verify-email`, `/reset-password/confirm`,
`/confirm-email-change`, each `?token=`) open their screens from both the bare
link in the email and the locale-prefixed one the web redirects to. The token is
a route param that the screen takes off the route as soon as it reads it
(`features/auth/link-token.ts`). Nothing in the link path logs a URL; keep it
that way, because the URL is the credential.

**Payment and payout-card returns** — `/<locale>/pledges/<id>?payment=returned|failed`
and `/<locale>/settings/payout?card=returned|failed` — are claimed, so a
provider's redirect that reaches the app outside the in-app browser session (the
process was killed while the payment page was up, or the link is opened later)
lands on the pledge or the payout panel through the same `listenForLinks`
(`links.test.ts`). While a session is open, its return belongs to the session:
`openPaymentPage` and `openCardRegistration` claim the route they return to
(`lib/auth-session-links.ts`), and the listener ignores a link to that route
until two seconds after the session settles. Without that, Android would deliver
the return twice — once to the session, once as an App Link or a forwarded
`ideanest://` link — and push the pledge over the checkout.

**Still to verify on a device**, with signed builds and the association files
served: that the return from each provider page ends the session exactly once on
both platforms, from Chrome Custom Tabs and from `ASWebAuthenticationSession`.
The unit tests cover the listener and the claim, not the browsers.

### The grant, on the web

`apps/web` serves `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` from `src/lib/mobile/association.ts`. Both need
identifiers that only exist once an application has been signed:

| Variable | Set on |
|---|---|
| `IDEANEST_IOS_APP_ID` | `apps/web` — `<team prefix>.az.ideanest.app` |
| `IDEANEST_ANDROID_PACKAGE` | `apps/web` — `az.ideanest.app` |
| `IDEANEST_ANDROID_SHA256_FINGERPRINTS` | `apps/web` — comma-separated, one per signing certificate |

Unconfigured serves **404**, deliberately: both platforms already expect that
from a site with no application and retry, whereas iOS caches a file with the
wrong identifier in it for up to a week. `assetlinks.json` carries no
`dynamic_app_link_components` (Android 15's server-side excludes): the intent
filter is already an allowlist, and a malformed extension is a verification
failure nobody sees.

**Host.** `associatedDomains` and the intent filter claim only `siteHost`, from
`IDEANEST_SITE_URL`. If `www.<site>` is served, it must **301 to the bare host
before any app-link check** — Apple does not follow redirects for the
association file, and a `www` link would otherwise open the browser. The owner to
confirm in Coolify; claiming `www` too would need its own association files.

`scripts/check-association.mjs` asserts that the two halves name the same
application and that the intent filter is the table. Nothing else does, and the
failure they produce is silent — the file is fetched, disagreed with, and links
quietly stop opening the application.

**Still to verify on a device:** that a refused link opened in the in-app browser
on Android is not handed straight back to the app by the app link it matches; and
that the bare origin `https://ideyanest.com`, with no trailing slash, opens the
app on Android. Android matches a `path` literally against `Uri.getPath()`, which
is empty for that URL, so the filter carries `android:path=""` beside `/` (aapt2
keeps the empty attribute; whether every Android version's manifest parser
registers it is what the device test answers).

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

When `registerForPush()` (the one call that may prompt) runs, and when the
prompt-free calls run (#160):

| Moment | Call |
|---|---|
| Cold start and every foreground, signed in | `syncPushRegistration()` from `src/lib/push-sync.tsx`: registers when already allowed; when the permission went from allowed to denied, `DELETE /v1/me/devices` |
| Right after sign-in | `registerIfAllowed()` (never prompts) |
| A pledge reaches `COLLECTED` on the payment return, a creator is followed, a campaign is saved | the explainer card (`src/features/notifications/push-explainer.tsx`), shown only while the phone has not decided; "Turn on" calls `registerForPush()`, "Not now" hides it for 30 days (MMKV) |
| `settings/notifications` | the "allow notifications" banner, and a Push switch moved from Off |

Never on launch while signed out, and never again after a refusal. The tap handler
(`src/lib/push-sync.tsx`, rules in `src/lib/push-taps.ts`) opens `data.url` through
`destinationFor`; a push of ours with no destination (`ideanest://`, a digest) opens
the inbox, and a `notificationId` in the payload marks that row read. The cold-start
tap is handled once per response. No badge is ever set.

`notifications` (#160) is the inbox — `GET /v1/me/notifications` paged by
`before`/`beforeId`, held in memory only (the `inbox` root is never persisted), with
the sentence and destination of each row from `@ideanest/account/inbox`, shared with
the web. The header bell's count is a one-row read of the same endpoint.

`settings/notifications` (#161) is one of those moments: turning a Push switch from
Off while the phone has not allowed IdeyaNest calls `registerForPush()`.
A refusal keeps the account's preference, and the screen says push is off in the
phone's settings, with a button to them, whenever the permission is denied. The
table's order and modes are `@ideanest/account/notifications`, shared with the web;
`settings/sessions` names devices with `@ideanest/account/sessions`.

## Offline (§4.12 MB-04)

`src/lib/offline.ts` persists TanStack Query's own cache to MMKV, so the screens
never know: `useQuery` answers from the cache it already answers from, and the
only difference offline is that the background refetch fails.

**Saved campaigns, pledges, campaign pages and the legal texts survive a restart. Feeds
and search results do not** — a feed is a ranking computed at a moment, and restoring last
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

`eas.json` has four profiles and `.github/workflows/mobile-release.yml` drives
them. It **builds** only on a manual dispatch, because a store build is a
deliberate act with a human behind it.

The **checks** — typecheck, tests, the Expo config resolving, the generated
images matching their inputs, the Android bundle exporting within its size
budget, and the association identifiers agreeing — are
`.github/workflows/mobile-check.yml`. `ci.yml` runs them on every change to
`apps/mobile`, `packages/**` or the brand mark, and `CI complete` fails when they
fail, so a red mobile test blocks the merge (#144). The release workflow runs the
same checks again before it builds or publishes.

Building needs Xcode and the Android SDK, which this repository does not own, so
the build runs on Expo's infrastructure and needs `EXPO_TOKEN` in the repository
secrets. Without it the workflow says so and stops rather than failing.

### What the owner sets up once

| Where | Name | What |
|---|---|---|
| `eas.json` → `build.base.env` | `IDEANEST_EAS_PROJECT_ID` | `@alievsteamss-team/ideanest` on expo.dev, owned by the organization (`owner` in `app.config.ts`), not by a person. Not a secret (every update manifest carries it), so it is committed. Unset, builds have updates switched off and no push token |
| GitHub secret (`mobile` environment) | `EXPO_TOKEN` | A robot token for the Expo account |
| GitHub secret | `IDEANEST_ASC_APP_ID` | The App Store Connect app id (digits). `eas submit` cannot read it from the environment, so the workflow writes it into the submit profile on the runner |
| GitHub secret | `IDEANEST_APPLE_TEAM_ID` | The 10-character Apple team id, written the same way and passed as `EXPO_APPLE_TEAM_ID` |
| EAS credentials (`eas credentials`) | — | The App Store Connect API key and the Play service-account key, held by EAS so neither is in the repository or in GitHub |

Without the two Apple ids, a production submit sends Android only and says so.

### Profiles

| Profile | Channel | API | Who installs it |
|---|---|---|---|
| `development` | `development` | `http://10.0.2.2:8080` on Android, `http://localhost:8080` on iOS | a developer: Android APK, iOS **simulator** |
| `preview` | `preview` | staging | testers: Android APK and an iOS **ad hoc** build, both `distribution: internal`. Register a tester's iPhone with `eas device:create` before building, or the build will not install on it |
| `production` | `production` | production | the stores: AAB to Play's `internal` track as a draft, iOS to TestFlight |
| `github` | `github` | production | anybody, from the repository's Releases page: an Android APK (`operation: github-release`, below) |

The Android submit goes to the `internal` track as a **draft**, which makes the
staged rollout a decision somebody takes in Play Console rather than a
consequence of a workflow finishing.

**GitHub Releases.** Run **Mobile release** with `operation: github-release`
(the `profile` input is ignored: it always builds `github`). EAS builds the APK,
the job downloads it and publishes a release tagged
`android-v<version>-<versionCode>` with the APK, its SHA-256 and the pull
requests merged since the previous APK. The tag never starts with `v`, because
`release.yml` deploys production on a `v*` tag. EAS generates the Android
signing key on the first build and reuses it, so each APK installs over the
last; download it once with `eas credentials -p android` and keep it with the
other keystores. The profile has its own channel because its name is part of
`extra` and so of the fingerprint: an update meant for these phones is
`operation: update` with `profile: github`, which publishes with EAS's
`production` environment, the one the profile builds with.

A submit also needs the end-to-end suite: the release workflow refuses it unless
the newest finished run of `.eas/workflows/e2e.yml` succeeded within the last 48
hours (see End-to-end tests below).

**Running against a local API.** An Android emulator's `localhost` is the
emulator itself; `10.0.2.2` is the host, which is why the development profile's
Android build uses it. With a development client, the JavaScript and its
configuration come from `expo start` on your machine, so set the origin there
too — `IDEANEST_API_ORIGIN=http://10.0.2.2:8080 pnpm start` — or, for an
emulator **or** a phone on USB, forward the port and keep `localhost`:
`adb reverse tcp:8080 tcp:8080`. The iOS simulator shares the host's network.

Android 9 and later refuse plain HTTP and iOS's App Transport Security refuses
it too, so `app.config.ts` grants `usesCleartextTraffic` and
`NSAllowsLocalNetworking` **only on request**: when `EAS_BUILD_PROFILE` is
`development` (EAS sets it on every build worker from the profile's name), or
when `IDEANEST_ALLOW_LOCAL_NETWORK=true`. Anything else, including nothing set,
means no exception, and it also takes out the `NSAllowsLocalNetworking` Expo's
iOS template ships for every build. A preview or production build cannot get them
by a forgotten variable, and neither can a release prebuilt on a laptop.

**A local native build against a local API** (`expo run:android`,
`expo run:ios`, `expo prebuild`) has no EAS profile, so opt in:
`IDEANEST_ALLOW_LOCAL_NETWORK=true IDEANEST_API_ORIGIN=http://10.0.2.2:8080 pnpm exec expo run:android`
(`http://localhost:8080` on the iOS simulator, or with `adb reverse`). Without
the variable the build refuses plain HTTP and every request to the local API
fails. `src/lib/build-config.test.ts` runs the native mods for each case.

### Over-the-air updates (§4.12 MB-13)

`expo-updates` with `runtimeVersion: { policy: 'fingerprint' }`. The runtime is
a hash of the native inputs, so a change that needs a new binary produces a new
runtime, and an update only ever reaches builds whose native code it matches.
Updates are for JavaScript-only changes.

`app.config.ts` imports the message catalogues, the colour tokens and the
claimed-route table for their values, and the fingerprint would otherwise hash
those files whole: fixing a typo in a web string would give the next update a
runtime no installed build has. `.fingerprintignore` leaves them out; what they
contribute (the native strings, the colours, the intent filters) still reaches
the hash through the resolved config. `scripts/check-fingerprint.mjs`, in
`mobile-check.yml`, proves it: no `packages/` file is hashed, an edit to an
unrelated catalogue key leaves the fingerprint alone, and an edit to
`mobile.native.displayName` changes it. A new workspace import in
`app.config.ts` fails that check until it is added to the ignore file.

Nothing publishes one on merge. Run **Mobile release** by hand with
`operation: update`, the channel (`preview`, `production` or `github`), a rollout
percentage (default 10) and a message. Widen or finish a rollout afterwards with
`eas update:edit` (or publish again at 100). The job exports the channel's
`eas.json` build environment and passes `--environment <channel>` first: `extra`
is part of the fingerprint, so an update evaluated with different variables
would carry the wrong API origin and match no build. With no
`IDEANEST_EAS_PROJECT_ID`, the job says so and publishes nothing.

**How a phone takes one.** `checkAutomatically: 'ON_LOAD'` stays: every cold
start checks natively, before any JavaScript runs, and downloads in the
background, which is how a fix for a bundle that crashes on launch arrives.
`lib/app-update.ts` adds a check each time the app returns to the foreground, at
most once per 15 minutes, and downloads what it finds. Once an update is on the
phone, `components/update-prompt.tsx` offers it in a `Dialog`: **Restart now**
reloads into it at once; **Later** hides the offer for that update, and the next
cold start launches it anyway. The offer waits while the reader is on checkout,
in the campaign editor or on the shipping-address form, where a restart would
lose their work, and behind the app lock.

### Icons, splash and the Play feature graphic

Every image is rendered by `scripts/generate-assets.mjs` from the brand mark the
web serves (`apps/web/src/app/icon.svg`) and the colour tokens — nothing is drawn
by hand. The script refuses a mark painted in anything but `colors.lime500`.

| File | What |
|---|---|
| `assets/icon.png` | 1024, lime mark on `surface1`, opaque (the App Store refuses alpha); iOS light |
| `assets/icon-dark.png` | iOS 18 dark: the mark on transparent |
| `assets/icon-tinted.png` | iOS 18 tinted: white mark on `surface1`, grayscale |
| `assets/adaptive-icon.png`, `assets/adaptive-icon-monochrome.png` | Android adaptive foreground (inside the 66% safe circle) and the Android 13+ themed icon |
| `assets/notification-icon.png` | 96 px, white on transparent, tinted lime by `expo-notifications` |
| `assets/splash-icon.png` | the splash mark, also the `dark` splash (the UI is dark only) |
| `store/feature-graphic.png` | Play's 1024 × 500 feature graphic, opaque |

After changing the mark or a token, run `node scripts/generate-assets.mjs` and
commit the PNGs. CI runs it with `--check`, which decodes each committed PNG and
a fresh render and fails when any channel of any pixel differs by more than 2:
pixels rather than bytes, because the PNG encoder's compressed output may differ
between machines. The renderer is `sharp`, pinned to an exact version, and the
mark is pure vector, so no font can be substituted.

### Native strings

The app's name and the iOS permission reasons (Face ID, camera, photo library)
are UI, so they live in the catalogue under `mobile.native` and reach the system
in all four languages: `app.config.ts` turns them into Expo `locales` (iOS
`InfoPlist.strings`, Android `strings.xml`) at config time, with nothing
generated to commit, and the base `Info.plist` gets the English copy. Both
plugins that write `NSFaceIDUsageDescription` read the same key.
`src/lib/native-strings.test.ts` holds the config to the catalogues.

### Bundle size: the `admin` namespace

Measured on 2026-10-08 with `expo export --platform android` (Hermes bytecode):

| Catalogues | `.hbc` | gzip -9 |
|---|---|---|
| as shipped, `admin` included | 8,553,676 B | 3,489,095 B |
| `admin` cut to the keys the app reads | 8,081,584 B | 3,340,900 B |
| saving | 472,092 B (5.5%) | 148,195 B (4.2%) |

**Decision: not stripped yet.** About 145 KB of download against a 30 MB
budget does not pay for a build step that rewrites the catalogues, and the app
does read `admin` keys today (`admin.moderation.reason.*` in the report sheet,
`admin.screens.campaignDirectory.state.*` in two lists), so stripping would
first need those moved to a shared namespace or an allowlist with a test. The
bundle-size budget (see "Performance budgets") now measures the bundle with
`admin` in it; revisit when that check fails, since stripping `admin` is the
largest saving available.

## Crash reporting (#165)

`@sentry/react-native` through its Expo config plugin, started from `index.ts`
before the route tree loads (`src/lib/crash/reporting.ts`). It reports native
crashes and JavaScript errors, render errors caught by the app's own boundaries
(`route-error-boundary.tsx`, `root-failure.tsx` — the SDK's `ErrorBoundary` is
not mounted, so it cannot pre-empt them), and release health.

- **Off without a DSN.** No `IDEANEST_SENTRY_DSN`, no SDK: not a disabled
  client, no client.
- **Naming.** `release` is `<version>+<build>`, `dist` the platform,
  `environment` the EAS channel. Metro writes a debug id into every bundle and
  its source map (`metro.config.js`), so a report finds its source map whatever
  release or OTA update shipped it.
- **Joining the service's log.** Every event carries `api_trace_id`, the
  `X-Trace-Id` of the last API response (`src/api/last-trace.ts`), copied onto
  the native scope as it changes so a native crash carries it too. A boundary
  error carries the trace id of the response it came from.
- **Who.** The account UUID and nothing else (`AccountSync`), cleared at
  sign-out.
- **Scrubbing.** `src/lib/crash/scrub.ts` ports the service's
  `Redaction.java` list — names and shapes — plus `Authorization`,
  `Idempotency-Key`, every `?token=` value, emails and the shipping and payout
  fields, in `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`.
  `scrub.test.ts` sends a crafted event through it. A native crash is written
  by the native SDK and never passes through `beforeSend`. The breadcrumbs it
  carries from JavaScript passed `beforeBreadcrumb` when they were recorded, and
  the tags and the user are set by this code (the account UUID, the trace id);
  but anything the native SDKs record themselves is not scrubbed by the app.
  sentry-cocoa's `NSURLSession` breadcrumbs — full URLs, `?token=` included —
  are therefore switched off (`enableNetworkBreadcrumbs: false`); Android records
  none, because OkHttp is only instrumented by Sentry's Gradle plugin, which is
  not used. Native stack frames, device context and the native SDK's own
  breadcrumbs (app lifecycle, memory warnings) are sent as they are.
- **Server-side scrubbing is required, not optional.** Turn on the
  destination's data scrubbing (Sentry: *Data Scrubber* and *Scrub IP
  addresses* in the project's security settings, plus the `token`,
  `authorization` and `idempotency-key` fields as additional sensitive fields;
  GlitchTip: its scrubbing settings) before the first build with a DSN ships. It
  is the only line that covers what the native SDKs record.
- **Off on purpose:** session replay (it would film the address and payment
  screens), screenshots and the view hierarchy. Tracing samples 10% of
  production sessions and nothing elsewhere.
- **Bundle cost:** the SDK adds about 1.2 MB of Hermes bytecode (8.55 MB →
  9.77 MB on the Android export). The bundle budget below is measured with it.

**Destination: sentry.io, EU data region** (decided 2026-10-08). Organization
`alievs-teams`, project `ideanest-mobile`, events stored in Frankfurt (DSN on
`ingest.de.sentry.io`). The DSN, `SENTRY_ORG` and `SENTRY_PROJECT` are committed
in `eas.json` `build.base.env`; only `SENTRY_AUTH_TOKEN` is a secret (an EAS
secret variable for builds, a GitHub secret for OTA updates). The project has
the Data Scrubber with its defaults, *Prevent storing IP addresses*, and the
app's own sensitive field names (tokens, idempotency key, two-factor and
recovery codes, email, phone, IBAN, card and address fields) switched on.

GlitchTip on Coolify was the alternative: the same protocol, but PostgreSQL,
Redis and worker processes on the small shared server, where a crash storm
would compete with the API.

Either way it is a **new data processor**: the privacy policy and both store
forms must name it before a build with a DSN is submitted
(`store/data-inventory.md`). OTA updates: the release workflow's `update` job
exports the channel's profile (so the environment is the channel) and, when
`SENTRY_AUTH_TOKEN` is set, runs `sentry-expo-upload-sourcemaps dist` on what
`eas update` exported. A manual `eas update` needs the same two steps.

## Store listing (#165)

`store/`: the listing texts in four languages, the App Store metadata
generated from them, the data inventory behind the privacy answers and the
iOS privacy manifest, and the store-gate checklist. See `store/README.md`.

## Performance budgets (#165)

Measured on **release** builds (Hermes) on reference devices: a mid-range
Android (a Samsung Galaxy A5x or a Pixel 6a) and an iPhone 12-class iPhone.

| Metric | Budget | How measured | Android mid-range | iPhone 12-class |
|---|---|---|---|---|
| Cold start → first Home content from cache | ≤ 2.5 s Android, ≤ 1.5 s iPhone | Median of 10 launches: `adb shell am start -W` plus an app `performance.mark` at first content / Xcode Instruments App Launch | not measured yet | not measured yet |
| Discovery feed scroll (200 cards, FlashList) | 60 fps target; ≤ 1% of frames over 32 ms; no blank cells after the first fling | Flashlight (Android) / Instruments Animation Hitches | not measured yet | not measured yet |
| JS bundle (Hermes bytecode) | Fail at +10% over the committed baseline | `scripts/check-bundle-size.mjs` in `mobile-check.yml`, after `expo export --platform android` | 9,774,784 bytes (baseline) | same bundle |
| Download size | iOS ≤ 50 MB; Android per device ≤ 30 MB | App Store Connect / Play Console | not measured yet | not measured yet |
| Memory while scrolling the feed | ≤ 250 MB | Android Studio profiler / Instruments | not measured yet | not measured yet |

**The bundle baseline** is `scripts/bundle-size-baseline.json`: 9,774,784 bytes,
the `.hbc` file `expo export --platform android` wrote on 2026-10-08 (Windows,
Node 22, SDK 57) from `main` plus crash reporting; 8,551,687 bytes before it. It
is the CI export, not a production EAS build — the same Metro graph and the same
`hermesc`, without the store's compression. Raising it is a reviewed edit with
the reason in the commit; the check says so when the bundle has fallen more
than 10% below it, so the budget can be lowered.

Motion rules (`docs/motion-system.md` §8) are part of the budget: transform and
opacity only, no animation in long lists.

## Checkout

`campaigns/[id]/back` (#157) is a full-screen modal: choose → review → pay.
The rules are `@ideanest/checkout`'s, shared with the web: the preview quote on
`decimal.js`, the draft body, idempotency keys bound to the request body (minted by
`expo-crypto`, kept in memory), the refusal table, and `attemptWithRetry`. Money writes go
through `src/api/mutate.ts`, whose signature requires an `Idempotency-Key`; nothing is sent
offline and nothing is queued. `src/features/checkout/use-checkout.ts` is the web's state
machine; `checkout-screen.tsx` draws it.

**Money motion (#280).** The contribution is typed on the kit's `AmountKeypad` (digits, the
point, backspace, `+ − × ÷` on `decimal.js` with `=` to take the result and `C` to start the
amount again, each result rounded half-even to the minor units, the amount handed to `useCheckout` as the same string the text field used to give; a
reward's price seeds it in plain form, `45.00` as `45`). Reserving first settles the keypad: an
operation still on screen commits its result if it is valid, and otherwise nothing is reserved
and the keypad says why (the same decision `=` makes). "Reserve and review" is a filled
`primary` pill, the step's one action; the lime is kept for the confirmation on step 2. Step 2 confirms with `SwipeToConfirm`: a drag released normally past
85% of the track calls `pay`, which is unchanged, so a second swipe after a failure sends the
same idempotency key; a drag the system cancels never commits, and a double activation sends
once. With a screen reader, or on Android any accessibility service (Switch Access), it is an
ordinary accent button; on iOS the track's `activate` action is what VoiceOver and Switch Control
perform. Android's service signal is broad on purpose: a password manager's autofill or an
automation tool is an accessibility service too, and such a person also gets the button — the
trade accepted so that nobody who cannot swipe meets a swipe. `SuccessReveal` is shown
by `pledges/[id]` only once a payment return reads the pledge back as `COLLECTED`, and it gives
the success haptic; nothing celebrates on the way out to the payment page.

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
`code` (or `UPLOADS_UNAVAILABLE` for a 503 without one, and `UPLOAD_TRANSFER_FAILED` for a request
that got no answer — a dropped connection is never reported as a fault of the file). A poll that
drops or answers 5xx is asked again on the next tick. The caller picks the words, from
`campaignEditor.cover.failures`. `settings/profile` saves the result as `avatarUrl` at once and
removes the picker's cache copy.

## The campaign video (#331)

`uploadVideo` in the same file takes a picked clip through the same three calls with a `video/*`
type, which is what makes the service open a video upload (250 MB instead of 20). Nothing is
converted on the phone: the picker already exported it, and the service transcodes every video to
one H.264/AAC MP4 of at most 720p and 60 s. The PUT reports its progress (`onProgress`), and the
poll is every 2 s for up to 5 minutes, because a minute of video takes about a minute to transcode.

The Basics tab's `VideoField` (`src/features/editor/video-field.tsx`) opens the library for videos
only: `allowsEditing` turns on iOS's trim UI and `videoExportPreset: H264_1280x720` makes iOS export
720p rather than send 4K. Android's library has neither, so a clip over 60.5 s or 250 MB is refused
on the phone, from the picker's own figures, before a byte is sent (`TOO_LONG`, `TOO_LARGE`). A READY
upload is saved at once as `{videoMediaId}`; removing it sends `{videoMediaId: null}`. The copy is
`mobile.editor.video`. There is no "record a video": the app declares no microphone permission.

The upload belongs to the editor, not the field: `useVideoUpload` is held by `EditorProvider`, so
switching from Basics to another tab (a route change that unmounts Basics) does not abandon a
transfer and transcode that take minutes; it attaches when READY and Basics shows where it has got
to. Closing the editor, or the app, does stop it, and the copy says to keep the app open. A wait
that outlives the 5 minutes keeps the upload's id and offers "Check again" (`resumeVideo`). A
`videoMediaId` the service refuses is taken out of the autosave's queue and stored offer
(`dropQueued`, `dropUnsent`), or every later save would carry it and be refused too.

The campaign page shows a play button over the cover (or the poster, without one), named with the
clip's length. **Nothing plays until it is pressed**, and the `expo-video` player is not mounted
before then (`campaign-video-player.tsx`), so a page that is scrolled past opens no stream. The
player uses the platform's own controls and fullscreen; background playback and picture in picture
are off in the plugin's options (`app.config.ts`). It pauses when the page stops being the one in
front (the screen's `focused && appActive`: a push to checkout leaves the page mounted underneath),
takes screen-reader focus when it opens, and on Android draws into a `TextureView`, which respects
the frame's rounded clip and the sticky header where a `SurfaceView` would not.

**`expo-video` is a native module.** Adding it changes the runtime fingerprint, so it reaches phones
through a new EAS build, never through an over-the-air update; an update cut from this code reaches only builds
that already contain it. Jest replaces it in `jest.setup.ts`.

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

## Static and legal pages (#164)

`about`, `how-it-works` and `trust-safety` are the web's three `(site)` pages, block for block
from the same `static.*` keys, drawn with `components/content/static-page.tsx`: title and summary,
17pt reading text, section headings, ruled lists, and a header action that shares the page's https
address. Inline `<b>` and link tags go through `RichParagraph`; each link pushes an app route and
is also a custom accessibility action on its paragraph, because nested `Text` links are hard to
reach with TalkBack. The words are bundled, so these pages work offline and on first launch.

`legal`, `legal/[document]` and `legal/[document]/v/[version]` read `GET /v1/legal/documents…`
in the app's language. The slugs, their service kinds, the response narrowing, the `/v/{n}` rule
and the paragraph split are `@ideanest/legal/documents`, shared with the web. A 404 is "not
published"; a failure is "could not be loaded" with a retry — never eight "Not published yet"
rows (#147). Dates are written in UTC, as the web's server writes them (`formatServerInstant`).
The texts are cached under `legalDocs` and persisted: each is versioned and hash-stamped, and its
provenance is printed above it. The digest wraps every eight characters and has a copy button.

`lib/links.ts` opens these paths from a push, an `ideanest://` link, or a universal or App Link:
they are rows of `@ideanest/links`' claimed-route table (see "Deep links").

## Pricing (#164)

`pricing` is the web's `/pricing`: the plans (`GET /v1/plans`), what the reader holds
(`GET /v1/me/subscription`, where a 401 is "sign in to choose a plan", not an error) and the
creator's fee disclosure (`GET /v1/fees/disclosure`). The wire types, their narrowing, the four
standings (pending, active, ending, lapsed) and the refusal map are `@ideanest/plans`, shared with
the web. Prices and rates stay decimal strings: free is `Decimal.isZero()`, amounts go through
`@ideanest/money`, percentages through `decimal.js`. None of the three is persisted — a stale price
or entitlement restored after a restart would mislead somebody about to pay.

`components/fees/fee-disclosure.tsx` is the one disclosure, with an `audience`: the checkout's
backer section and Pricing's creator card. A failed read says the rate could not be loaded and is
never the unconfigured sentence, which says nothing is deducted (#145).

**Where a plan is chosen.** A plan unlocks publishing, and both stores generally require their own
billing for a subscription that unlocks app functionality (App Review 3.1.1, Google Play's payments
policy). Until the owner decides between store billing and a written exemption, builds leave
`IDEANEST_IN_APP_PLAN_CHOICE` unset: the cards have no button, and one "Open the pricing page"
action opens the web page in the in-app browser. When it closes, the subscription is read again.
With the flag on, the cards choose (`POST`) and the held panel cancels (`DELETE`) in the app, as
the web's `PlanChooser` does. Store billing itself is not built.

`?from=submit&project=<id>` — what a refused submission adds — draws the banner with a way back to
the campaign's review step, and an entitling plan replaces the screen with that step; a pending
one never does. While a pending plan is held from a submission, the subscription is re-read every
time the app returns to the foreground (the creator coming back from a banking app). The id is
accepted only as a UUID, by the route and by `lib/links.ts`, and is never fetched.

## Starting and editing a campaign (#162)

`campaigns/new` is the web's "Start a project": one title, `POST /v1/projects`, then
`router.replace` to the draft's Basics. The tab bar's Create and Me's "Start a campaign" land
there; signed out, through sign-in and back.

`campaigns/[id]/edit/*` is the editor. The frame (`src/features/editor/editor-frame.tsx`, the
route group's `_layout.tsx`) names the project in the stack header with the save indicator on
the right, draws the state tag and the six tab pills, and owns the states every tab shares
(signed out, failed with the 403/404 wording, offline). Tabs replace the route after flushing
the autosave, so Back leaves the editor. All six tabs are native.

The rules — limits, validation, single-field patches, the autosave machine, the copy builders —
are `@ideanest/campaign-editor`'s, shared with the web. What the app adds:

- **One autosave per open project** (`editor-context.tsx`, `use-autosave.ts`) for every
  `PATCH /v1/projects/{id}` field, whichever tab sends it: 800ms debounce, flush on blur, on a
  tab switch and when the app goes to the background, one request in flight, a failed patch
  kept for a lossless retry.
- **The unsent patch survives an app kill.** It is written to MMKV per project on every change
  (`lib/unsent-edits.ts`) and, on reopening, OFFERED ("A change from {time} was not saved",
  Send it / Discard) — never sent on its own. The session ending erases every one.
- **The project is persisted** under `projectEdit`, so offline the editor shows it as last
  loaded, read-only. Online, a tab builds its form only once this session has read the project from the
  service (`useEditor().fresh`), never from the cached copy alone, and seeds it with the autosave's
  unacknowledged patch laid over it (`withUnsaved`), so a tab mounted again shows what was typed.
- **Money fields** (`money-field.tsx`) turn a lone decimal comma into a point as it is typed —
  on every device, since Gboard and other keyboards offer `,` whatever the phone's separator — and
  hand `parseAmount` the result (`1,500` becomes `1.500` and is refused, never read as thousands); **dates** (`date-time-field.tsx`) use the platform picker and
  send what the web's `fromDateTimeLocal` sends; **images** (`image-source.tsx`) come from the
  library, the camera (uploaded through `lib/media/upload.ts`) or a measured address.
- Building blocks for the next tabs: `editor-modal.tsx` (full-screen editor, dirty dismiss
  asks first), `delete-dialog.tsx`, `use-reorder.tsx` (move buttons, accessibility actions,
  one queued request).

**Story** (`src/features/editor/story/`) is the web's block editor as cards in one scroll view
(not a virtualised list, which loses a focused input on recycle), with the keyboard avoided and
the focused field scrolled into view. The app draws edge to edge, so Android does not resize the
window for the keyboard: the Story tab and the new-project screen measure what the keyboard
covers (`keyboard-overlap.ts`) and pad by it on both platforms. The story is saved as ONE document through the shared
autosave, and only while every block passes `storyProblems`; an incomplete block pauses saving
and says so. The held document is kept in the editor's store (`held-story.ts`, erased at
sign-out with the unsent changes), so leaving the tab or the OS killing the app does not lose it;
if the service's story changed meanwhile, the tab asks which copy to keep. Bold and Italic sit above each text field (and above the keyboard on iOS, in an
`InputAccessoryView`) and apply the shared `toggleMark` to the selection, so the markdown is the
web's. Blocks move by buttons and by accessibility actions, locally — the order is part of the
document. Image blocks upload from the library or camera as well as taking an address, which
the web does not yet offer. "Earlier versions" is a full-screen modal with preview and a
confirmed restore — which waits until nothing is on its way to the service — after which the
editor is re-seeded from the server.

The editor has no motion but the stack's transitions and the save indicator's spinner (still
under Reduce Motion): the frame sets the kit's motion budget to `none`.

**Pre-launch** (`features/editor/prelaunch/`) edits the title, summary and cover on the same
autosave as Basics, seeded the same way (`canSeed`, `seed`, re-seeded in place by
`reseedDraft`). Opening the page asks first in the kit's white dialog and is refused while a
field the phone refused is unsent (the page would publish the older text); otherwise it flushes
the autosave (retrying a change that failed before), waits for it to settle (a refused change
stops the opening), then sends `POST /v1/projects/{id}/prelaunch`. Cancel stops waiting at any
point; an answer that still arrives is applied. While the page is open it shows the follower count from the
public page's own `usePrelaunchPage`, and the link `{siteUrl}/projects/{id}/prelaunch` with Copy
(`expo-clipboard`, announced) and the native share sheet.

**Review** (`features/editor/review/`) reads `GET /v1/projects/{id}/checklist` under the
`projectEdit` root (persisted, erased at sign-out), again on every visit and once more when the
autosave settles, so a requirement fixed on another tab a moment ago is not still shown missing. Which states draw Submit or Launch is the
package's `offersSubmit` / `offersLaunch`, shared with the web; whether the campaign may be
submitted is the server's answer alone. A blocked "Submit for review" is the kit pill's
`softDisabled` — announced disabled at 40%, but a press moves screen-reader focus to the
required list. `SUBSCRIPTION_REQUIRED` opens `pricing?from=submit&project={id}`; a plan limit
offers the plans beside the refusal. Launch is confirmed inline, with focus on "Launch now". The
completeness bar is the one motion the editor allows: the kit `ProgressBar`'s `rise="progress"`
(800ms, once), drawn at its figure under Reduce Motion, and without the funded glow at 100%.

## End-to-end tests (§19.2 `test-e2e`, #165)

Maestro flows in `e2e/maestro/`, run on a `preview` build against **staging** with the
fixtures `ops/seed/e2e/seed.mjs` creates. Nothing is ever paid: the checkout flow stops
at the hand-off to the payment provider's page.

**Not yet run anywhere.** The hosts the `preview` profile names (`staging.ideanest.az`,
`staging-api.ideanest.az`) do not resolve (checked 2026-10-08); the iOS jobs build the
`preview-simulator` profile (`extends: preview`, `ios.simulator: true`). The flows pass `maestro check-syntax`
and the workflow passes the EAS Workflows schema; neither has met a device and a service.

| Flow | What it proves | Tags |
|---|---|---|
| `browse-to-checkout.yaml` | Signed-in backer: Home → the seeded campaign's card → its title, funding and rewards → Back this → a tier → reserve (the hold's countdown) → swipe to pay → the provider's page in the in-app browser → closed without paying → the review step or the pledge | `checkout` |
| `payment-failed-return.yaml` | `https://<site>/az/pledges/<id>?payment=failed` opens that pledge in its failure state | `checkout`, `links` |
| `sign-in-2fa.yaml` | Me → Sign in → address and password → the two-factor step → the code → Me names the account → sign out → the saved list is signed out, no row left from the offline copy | `two-factor` |
| `creator-autosave.yaml` | The draft's id-form link `/projects/<uuid>/edit/basics` → a new title → saved after the 800 ms debounce → app killed and started → the title persisted | `editor` |
| `creator-autosave-offline.yaml` | The same with airplane mode switched on as the title is typed: the change is kept, the retry saves it once online | `editor`, `android-only` |
| `links.yaml` | Every `CLAIMED_ROUTES` route, opened unprefixed, locale-prefixed and as `ideanest://`, each from a stopped app, lands on its screen; `https://<site>/az/admin` does not open the app | `links` |
| `screenshots.yaml` | Flows 1–3 once per language with `takeScreenshot` (`<locale>-<nn>-<screen>.png`), for the store listings | `screenshots` |

`e2e/maestro/config.yaml` runs the checkout first; `subflows/` holds the shared steps.

**How a flow knows where it is.** Every route wraps its screen in `withScreenRoot('<name>', …)`
(`src/components/screen-root.tsx`), a `View` with `testID="screen-<name>"` that every state of
the route shares — loading, failed, signed out. `src/lib/screen-roots.test.ts` fails a route
without one and two routes with the same name. Other ids the flows use are the components' own
(`tab-<name>` on the tab bar, `campaign-card`, `save-status-<state>`, `me-sign-in`, …).

**`links.yaml` is generated**, never edited: `node e2e/generate-links-flow.mjs` writes it from
`@ideanest/links`' `CLAIMED_ROUTES`, reading each landing screen's name from its route file. It
refuses to write a flow that misses a row, a route or a pattern of the table, and
`screen-roots.test.ts` runs it with `--check`, so a row added to the table fails the mobile tests
until the flow is regenerated (with a sample in the generator's `SAMPLES` for the new route).

### When it runs

`.eas/workflows/e2e.yml` (EAS Workflows; it lives beside `eas.json`, the project root EAS reads):

- **nightly** at 01:30 GMT, and **by hand** (`eas workflow:run e2e.yml`, or the Expo dashboard;
  the `screenshots` input adds the store screenshots on a Pixel and a 6.9" iPhone);
- **before every store submission**: `mobile-release.yml` refuses `submit` without a green run in
  the last 48 hours;
- **not per pull request**: issue #67's minutes budget. A mobile pull request is held by
  `CI complete` (typecheck, unit tests, config) instead.

Android runs first, then iOS (the flows share the seeded accounts, and one backer holds one live
pledge per campaign). The two-factor flow is a job of its own on each platform, because its
code is computed with `oathtool --totp -b "$E2E_TOTP_SECRET"` immediately before it, at the top of
a 30-second window. The next window's code is passed too: the service accepts one step of skew,
so when the first has expired by the time it is typed, the flow retries once with the second.

### Variables and secrets

Maestro hands a flow every shell variable named `MAESTRO_*`, on EAS and locally alike, so the
inputs are stored under that prefix: as EAS environment variables in the `preview` environment
(passwords and the TOTP secret with secret visibility), or exported in your shell.

| Variable | What |
|---|---|
| `MAESTRO_SITE` | The staging site's https origin, the host the preview build claims |
| `MAESTRO_BACKER_EMAIL`, `MAESTRO_BACKER_PASSWORD` | The seeded backer |
| `MAESTRO_TWOFA_EMAIL`, `MAESTRO_TWOFA_PASSWORD`, `MAESTRO_TWOFA_NAME` | The seeded two-factor account |
| `MAESTRO_CREATOR_EMAIL`, `MAESTRO_CREATOR_PASSWORD` | The seeded creator |
| `MAESTRO_PROVIDER_HOST` | A regular expression for the payment provider's host, as the browser's address bar shows it (default `epoint`) |
| `MAESTRO_CAMPAIGN_ID`, `_CAMPAIGN_PATH`, `_CAMPAIGN_TITLE`, `_TIER_ID`, `_PLEDGE_ID`, `_DRAFT_ID`, `_CREATOR_SLUG`, `_CATEGORY_SLUG`, `_SUBCATEGORY_SLUG`, `_COLLECTION_SLUG`, `_LEGAL_DOCUMENT`, `_LEGAL_VERSION` | What the seed prints, each with `MAESTRO_` in front |
| `MAESTRO_OTP`, `MAESTRO_OTP_NEXT` | The two codes; the workflow computes them, locally you do |
| `E2E_TOTP_SECRET` | The two-factor account's base32 secret (20 bytes). Deliberately **not** `MAESTRO_`-prefixed, so no flow can read it |

No password, code or secret is ever written to the repository.

### The fixtures

```bash
E2E_API_ORIGIN=https://<staging-api> E2E_DATABASE_URL=postgres://… \
E2E_TOTP_SECRET=… E2E_BACKER_PASSWORD=… E2E_TWOFA_PASSWORD=… E2E_CREATOR_PASSWORD=… \
  node ops/seed/e2e/seed.mjs --env-file fixtures.env   # --dry-run checks the target only
```

Idempotent; it prints the fixture ids as `KEY=value`. Through the public API wherever it can; SQL
only to verify the three addresses, set the known TOTP secret, take the campaign live (submission
needs an agreement, a subscription and a staff approval) and keep its deadline 30 days out — the
header of the script says why for each. **It refuses production** (the production names and
address, and a token whose issuer is production) and refuses a database that is not the API's.
Start the suite at least five minutes after a run: the seeded backer's draft pledge holds its
reward for five minutes, and the same backer cannot reserve again meanwhile.

Staging must also allow the suite's sign-ins: the service allows five per address and per
account in fifteen minutes (`ideanest.auth.rate-limit`), and one platform's run signs in about
five times. Raise `IDEANEST_AUTH_RATELIMIT_SIGNINSPERADDRESS` and
`IDEANEST_AUTH_RATELIMIT_SIGNINSPEREMAIL` **on staging only**.

### Running it locally

Maestro needs Java 17 or later (`java -version`). Against a USB phone or an emulator with a
`preview` build installed (`adb devices` lists it):

```bash
cd apps/mobile
set -a; . <(sed 's/^/MAESTRO_/' fixtures.env); set +a     # the seed's output, prefixed
export MAESTRO_SITE=https://<staging-site> MAESTRO_BACKER_EMAIL=… MAESTRO_BACKER_PASSWORD=…  # and the rest
maestro test e2e/maestro --exclude-tags two-factor,screenshots

export MAESTRO_OTP=$(oathtool --totp -b "$E2E_TOTP_SECRET")
export MAESTRO_OTP_NEXT=$(oathtool --totp -b --now "@$(( $(date +%s) + 30 ))" "$E2E_TOTP_SECRET")
maestro test e2e/maestro/sign-in-2fa.yaml

maestro check-syntax e2e/maestro/links.yaml   # a syntax check without a device
```

On iOS, `creator-autosave-offline.yaml` is skipped (`--exclude-tags android-only`): Maestro
cannot switch a simulator's airplane mode. Its failure branch is also a race on Android: the
editor turns read-only as soon as it knows it is offline, so the connection is cut inside the
autosave's 800 ms debounce, and when the patch has already left the flow only proves the title
was saved. Sign-out on iOS taps the alert's English labels; store screenshots stop before it.

## What is not built

**Google sign-in on Android.** The iOS flow cannot be used there: Google refuses
custom-scheme redirects for Android OAuth clients, and there is no https endpoint of
ours to redirect to. The native route, Credential Manager, has to put our nonce in
the token (the service has `require-nonce: true`), which the free Google Sign-In
library does not do. It needs a small native module and a device to check it on.
Apple has no Android SDK. Android offers email and password meanwhile (#241).

**Four of the campaign page's tabs and its report sheet.** Creator, FAQ, Updates and
Comments open the same tab on the campaign's web page, and "Report this campaign" is not
drawn yet; each is a file of its own under `src/components/campaign/` (see "The campaign
page" above) that the rest of #155 replaces.

**A device.** Nothing here has been run on one. The tests, the typecheck and the
Expo config resolution all pass; what they cannot cover is push delivery, the
universal-link grant, and store review, all three of which need signed builds and
credentials this repository does not hold.
