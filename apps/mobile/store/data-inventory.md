# Data inventory (`apps/mobile`)

The one table that App Store Connect's **App Privacy** answers, Google Play's
**Data safety** answers and the iOS privacy manifest (`ios.privacyManifests` in
`app.config.ts`) are all read from — issue #165. When the app starts collecting
something new, this table changes first, in the same pull request, and the
three follow it. `store/data-inventory.test.ts` fails when the manifest's
`NSPrivacyCollectedDataTypes` and the **iOS manifest type** column disagree.

Common to every row unless it says otherwise:

- **Linked to the user**: yes. Everything below belongs to an account.
- **Used for tracking**: no. There is no advertising SDK, no cross-app
  identifier, and `NSPrivacyTracking` is `false` with no tracking domains.
- **Purpose**: app functionality only. Nothing is used for advertising,
  marketing by third parties, or analytics beyond crash diagnostics.
- **Sold or shared with third parties** (Play): no. Processors that act on the
  platform's behalf are named in the privacy policy, not "shared".
- **Encrypted in transit**: yes (https only; the build refuses an http DSN).
- **Deletion**: the account can be closed in the app (Settings → Privacy, "Data
  and closure"), and on the web at `/<locale>/settings/privacy`.

| Data | What exactly | Who provides it | Optional | iOS manifest type | Play Data safety category |
|---|---|---|---|---|---|
| Email address | Sign-in and account email; email change | Every account | No (needed to sign in) | `EmailAddress` | Personal info → Email address |
| Name | Display name; legal name on a creator's payout details; recipient on a shipping address | Every account; creators; backers who ship | Display name no, others when used | `Name` | Personal info → Name |
| Phone number | The phone field of a shipping address | Backers of a campaign with physical rewards | Yes | `PhoneNumber` | Personal info → Phone number |
| Physical address | Shipping address (encrypted at rest, `docs/architecture.md` §7.2 `shipping_addresses`); a creator's registered address | Backers who ship; creators | Yes | `PhysicalAddress` | Personal info → Address |
| User ID | The account UUID. Also the only user identity crash reports carry | Every account | No | `UserID` | Personal info → User IDs |
| Device IDs | The Expo push token, registered with `/v1/me/devices` to deliver notifications. In a build with updates on (`IDEANEST_EAS_PROJECT_ID`), also the EAS client ID: a random per-install UUID `expo-updates` sends to Expo with every update check (the `EAS-Client-ID` header). The app never links that one to the account, but Expo receives it, so it is declared under the same type | Push token: signed-in devices that allow notifications. EAS client ID: every install of a build with updates on | Push token yes (notification permission); EAS client ID no | `DeviceID` | Device or other IDs |
| Purchase history | Pledges: campaign, reward, amount, status, refunds | Backers | No (it is the product) | `PurchaseHistory` | Financial info → Purchase history |
| Other financial info | A creator's payout details: legal subject, tax ID, registration number. **Not** the payout card itself, which is entered on the provider's page | Creators who withdraw | Yes (only to be paid) | `OtherFinancialInfo` | Financial info → Other financial info |
| Photos | Campaign cover and story images, avatar — only the images the person picks or takes | Creators; anyone setting an avatar | Yes | `PhotosorVideos` | Photos and videos → Photos |
| Other user content | Campaign text, rewards, FAQ, updates, comments, survey answers, profile bio and links | Creators and backers | Yes | `OtherUserContent` | App activity → Other user-generated content |
| Customer support | Reports of a campaign or comment, pledge disputes | Whoever files one | Yes | `CustomerSupport` | Messages → Other in-app messages |
| Crash data | Native crashes and JavaScript errors, scrubbed (`src/lib/crash/scrub.ts`) | Every device — **only in a build with `IDEANEST_SENTRY_DSN`** | No (on by default in such a build) | `CrashData` (DSN only) | App info and performance → Crash logs |
| Performance data | Traces of 10% of production sessions (app start, screen loads, network timings) | As above, DSN only | No | `PerformanceData` (DSN only) | App info and performance → Diagnostics |
| Other diagnostic data | Breadcrumbs (scrubbed), device model, OS version, app version, the last `X-Trace-Id` | As above, DSN only | No | `OtherDiagnosticData` (DSN only) | App info and performance → Other app performance data |

## Not collected

| Data | Why not |
|---|---|
| Payment card data | Cards are entered on the payment provider's hosted page (§17.2, SAQ A). The app never sees the number |
| Precise or coarse location | No location permission is requested. Proximity search (§4.12 MB-16) is not built; if it is, this table changes first |
| Contacts | Never read |
| Browsing or search history | Search queries are sent to answer the search and not kept by the app. **Confirm before submission** that the API does not retain them (request logs included); if it does, this becomes a "Search history" row |
| Health, fitness, sensitive info, audio, emails or texts | Never read. The microphone permission is explicitly removed (`expo-image-picker` plugin) |
| Advertising data, tracking | No advertising SDK, no IDFA, no tracking |
| Biometric data | Face ID and fingerprint are the operating system's: the app asks whether the owner is present and is told yes or no |

## Processors the privacy policy must name

- **The payment provider** (cards, payouts).
- **Expo (650 Industries, Inc.), as two services:**
  - **Push service**, and through it Apple Push Notification service and
    Firebase Cloud Messaging: the device's push token, the notification payloads
    (title, body, the link they open), and the device's IP address when the token
    is requested.
  - **EAS Update**, in a build with updates on: on every launch's update check,
    the device's IP address, the EAS client ID (above), the platform, the
    runtime version, the channel and the IDs of the running and embedded
    updates. Nothing about the account. The IP address is not used by the app
    to locate anyone, so no location row; if the privacy policy or Expo's terms
    say Expo derives location from it, this changes first.

  Expo is a processor for both, and the privacy policy must name it.
- **The crash-reporting destination**, if `IDEANEST_SENTRY_DSN` is set:
  Sentry (Functional Software, Inc., EU data region) or the platform's own
  GlitchTip on the Coolify server. This is a new processor — the privacy
  policy (`legal/privacy-policy`) and both store forms must name it before a
  build with a DSN is submitted.

## Required-reason APIs (iOS)

`ios.privacyManifests.NSPrivacyAccessedAPITypes` declares what the app answers
for itself: `UserDefaults` (CA92.1), file timestamps (C617.1), system boot time
(35F9.1) and disk space (E174.1). Pods that ship their own manifest (React
Native, `expo-application`, `expo-constants`, `expo-device`,
`expo-file-system`, `expo-localization`, `expo-notifications`,
`expo-system-ui`, the Sentry Cocoa SDK, SDWebImage under `expo-image`) are
merged into the app's file at `pod install` by React Native's privacy
aggregation (`privacy_file_aggregation_enabled`, on by default). Found by
reading every dependency's `PrivacyInfo.xcprivacy` and grepping the iOS sources
of those without one; `expo-sharing` reads `UserDefaults` with no manifest of
its own, which CA92.1 covers.

**This is not verified until Xcode says so.** Archive a production build,
then Organizer → the archive → *Generate Privacy Report*, and compare the
report with this table before submitting.
