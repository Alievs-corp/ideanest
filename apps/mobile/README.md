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

## Configuration

Two variables, read at **build** time by `app.config.ts` and surfaced through
`Constants.expoConfig.extra`. Both are the names `apps/web` already uses, so a
deployment answers "where is the API" once rather than twice.

| Variable | Meaning |
|---|---|
| `IDEANEST_API_ORIGIN` | Where the Spring Boot service listens |
| `IDEANEST_SITE_URL` | The public origin whose links this application claims |

A value that is set but unusable **throws the build** rather than falling back.
An unset variable is somebody running locally; `IDEANEST_SITE_URL=ideanest.az`
with no scheme is a misconfiguration that would otherwise ship a build pointing
at localhost.

`eas.json` sets both per profile. `development` points at localhost, `preview`
at staging, `production` at production.

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
string.

The browse pages are claimed too (#154): `/categories` and `/collections`, and
everything under each. A slug is decoded once and handed to the screen as a
route param; `/categories/a/b/c` is refused.

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

**Checkout.** §4.5, not built in the app yet. The campaign page's call to action opens
the web checkout, which works today.

**Comments.** §4.4 and §4.9 ask for them and what is here is the count and a link. §4.6's
thread is moderated, reportable and rate-limited, and half of it is meaningless
without an account this application cannot yet create.

**Rich story formatting.** The story is a TipTap document and is rendered as
paragraphs of plain text — `src/lib/story.ts` argues why a second renderer that
disagreed with the web about list nesting would be worse than the missing bold.

**A device.** Nothing here has been run on one. The tests, the typecheck and the
Expo config resolution all pass; what they cannot cover is push delivery, the
universal-link grant, and store review, all three of which need signed builds and
credentials this repository does not hold.
