import { getLocale, getTranslations } from 'next-intl/server';
import { pricingCopyFrom, type PricingCopy } from './plans-copy';
import {
  type AuthFailuresCopy,
  type EmailChangeCopy,
  type PasswordResetConfirmCopy,
  type PasswordResetCopy,
  type RegisterCopy,
  type SignInCopy,
  type VerifyEmailCopy,
  authFailuresCopyFrom,
  emailChangeCopyFrom,
  passwordResetConfirmCopyFrom,
  passwordResetCopyFrom,
  registerCopyFrom,
  signInCopyFrom,
  verifyEmailCopyFrom,
} from './auth-copy';
import { type CheckoutCopy, checkoutCopyFrom } from './checkout-copy';
import {
  type PledgeListCopy,
  type PledgeManagerCopy,
  pledgeListCopyFrom,
  pledgeManagerCopyFrom,
} from './pledges-copy';
import {
  type BackerReportCopy,
  type DashboardMetaCopy,
  type DashboardNavCopy,
  type DashboardOverviewCopy,
  type FinanceCopy,
  type FundingChartsCopy,
  type SurveyBuilderCopy,
  backerReportCopyFrom,
  dashboardMetaCopyFrom,
  dashboardNavCopyFrom,
  dashboardOverviewCopyFrom,
  financeCopyFrom,
  fundingChartsCopyFrom,
  surveyBuilderCopyFrom,
} from './dashboard-copy';
import {
  type SignalListCopy,
  followingListCopyFrom,
  savedListCopyFrom,
} from './signals-copy';
import { type SurveysCopy, surveysCopyFrom } from './surveys-copy';
import { type ReportControlCopy, reportControlCopyFrom } from './report-copy';
import { type PayoutPanelCopy, payoutPanelCopyFrom } from './payout-copy';
import { type CampaignControlsCopy, campaignControlsCopyFrom } from './campaign-controls-copy';
import type { PluralForms } from '@ideanest/ui';
import {
  type BasicsPanelCopy,
  type EditorChromeCopy,
  type FaqPanelCopy,
  type PrelaunchPanelCopy,
  type ReviewPanelCopy,
  type EditorMetaCopy,
  type NewProjectCopy,
  type RewardsPanelCopy,
  type StoryPanelCopy,
  basicsPanelCopyFrom,
  editorChromeCopyFrom,
  faqPanelCopyFrom,
  prelaunchPanelCopyFrom,
  reviewPanelCopyFrom,
  editorMetaCopyFrom,
  newProjectCopyFrom,
  rewardsPanelCopyFrom,
  storyPanelCopyFrom,
} from './campaign-editor-copy';
import {
  type CampaignActionsCopy,
  type CommentCopy,
  type LiveFundingCopy,
  campaignActionsCopyFrom,
  commentCopyFrom,
  liveFundingCopyFrom,
} from './campaign-copy';
import { localeOrDefault, type Locale } from './locale';
import {
  type ProfileCopy,
  type ProfileEditorCopy,
  type ProfileVisibilityCopy,
  profileCopyFrom,
  profileEditorCopyFrom,
  profileVisibilityCopyFrom,
} from './profile-copy';
import {
  type InboxCopy,
  type PreferencesCopy,
  inboxCopyFrom,
  preferencesCopyFrom,
} from './notifications-copy';
import { type ProjectCardCopy, projectCardCopyFrom } from './card-copy';
import { type PrelaunchCopy, prelaunchCopyFrom } from './prelaunch-copy';
import { type FeedCopy, feedCopyFrom } from './feed-copy';
import {
  type AdminShellCopy,
  type ConsoleIndexCopy,
  adminShellCopyFrom,
  consoleIndexCopyFrom,
} from './admin-copy';
import {
  type AccountClosurePanelCopy,
  type DataExportPanelCopy,
  type EmailChangePanelCopy,
  type PasswordChangePanelCopy,
  type SessionsPanelCopy,
  type TwoFactorPanelCopy,
  accountClosurePanelCopyFrom,
  dataExportPanelCopyFrom,
  emailChangePanelCopyFrom,
  passwordChangePanelCopyFrom,
  sessionsPanelCopyFrom,
  twoFactorPanelCopyFrom,
} from './settings-copy';
import { type TrailCopy } from '../seo/structured-data/breadcrumb';
import { trailCopyFrom } from './trail-copy';
import {
  type FailureCopy,
  type FooterCopy,
  type ShellCopy,
  type WhatsAppCopy,
  failureCopyFrom,
  footerCopyFrom,
  shellCopyFrom,
  shellSearchCopyFrom,
  whatsappCopyFrom,
} from './shell-copy';

/**
 * The shell's copy, read from the request's catalogue — issue #324.
 *
 * <h2>Why this is a second file</h2>
 *
 * `shell-copy.ts` holds the types and the pure builders and imports nothing from
 * `next-intl/server`. That split is what lets a component test build the identical object out
 * of `messages/*.json` — asserting against the words the application will draw rather than
 * against words retyped into the test, which is a test that passes whatever the catalogue
 * says. Keeping the server call here means importing the shape never drags a server module
 * into a client bundle.
 */
export async function shellCopy(): Promise<ShellCopy> {
  return shellCopyFrom(await getTranslations('shell'));
}

export async function footerCopy(): Promise<FooterCopy> {
  return footerCopyFrom(await getTranslations('shell'));
}

/**
 * The floating WhatsApp control's words — `shell-copy.ts` explains why they are their own object.
 *
 * Resolved by `SiteShell` beside `shellCopy`, and handed to the launcher whole. One extra
 * lookup on a render that was already reading this namespace.
 */
export async function whatsappCopy(): Promise<WhatsAppCopy> {
  return whatsappCopyFrom(await getTranslations('shell'));
}

export async function failureCopy(): Promise<FailureCopy> {
  return failureCopyFrom(await getTranslations('shell'));
}

/**
 * The search box's own words, for the one place it is not inside the shell.
 *
 * `SiteHeader` and `MobileNavDrawer` already hold a whole `ShellCopy` and pass
 * `copy.search` from it. `/search` renders the same component at the top of its results
 * and needs nothing else from the namespace, so it resolves the one key rather than the
 * shell's entire vocabulary.
 */
export async function searchFieldCopy(): Promise<ShellCopy['search']> {
  return shellSearchCopyFrom(await getTranslations('shell'));
}

/* -------------------------------------------------------------------------
 * The authentication screens — issue #324
 *
 * One accessor per route rather than one for the whole namespace. Each of the six pages under
 * `app/[locale]/(auth)` renders one form, and handing it the vocabulary of the other five
 * would put every word of the account-recovery flow into the flight payload of the sign-in
 * page. `auth-copy.ts` carries the rest of the reasoning.
 * ---------------------------------------------------------------------- */

/** Just the refusal vocabulary, for the two credential panels in `components/settings`. */
export async function authFailuresCopy(): Promise<AuthFailuresCopy> {
  return authFailuresCopyFrom(await getTranslations('auth'));
}

export async function signInCopy(): Promise<SignInCopy> {
  return signInCopyFrom(await getTranslations('auth'));
}

export async function registerCopy(): Promise<RegisterCopy> {
  return registerCopyFrom(await getTranslations('auth'));
}

export async function passwordResetCopy(): Promise<PasswordResetCopy> {
  return passwordResetCopyFrom(await getTranslations('auth'));
}

export async function passwordResetConfirmCopy(): Promise<PasswordResetConfirmCopy> {
  return passwordResetConfirmCopyFrom(await getTranslations('auth'));
}

export async function verifyEmailCopy(): Promise<VerifyEmailCopy> {
  return verifyEmailCopyFrom(await getTranslations('auth'));
}

export async function emailChangeCopy(): Promise<EmailChangeCopy> {
  return emailChangeCopyFrom(await getTranslations('auth'));
}

/**
 * The two credential panels under `/settings` — `settings-copy.ts` explains why these two.
 *
 * Both read `auth` as well as their own namespace, so the password policy sentence and the
 * refusal vocabulary have one spelling across the six authentication routes and these panels.
 */
export async function emailChangePanelCopy(): Promise<EmailChangePanelCopy> {
  return emailChangePanelCopyFrom(
    await getTranslations('settings.panels'),
    await getTranslations('auth'),
  );
}

export async function passwordChangePanelCopy(): Promise<PasswordChangePanelCopy> {
  return passwordChangePanelCopyFrom(
    await getTranslations('settings.panels'),
    await getTranslations('auth'),
  );
}

/**
 * The three panels somebody secures or closes an account with — issue #80.
 *
 * Each takes `auth` as well as its own namespace, for the reason the two credential panels
 * above do: the refusal vocabulary is one object, shared with the six authentication routes,
 * rather than a second spelling of "That did not work" under `settings.panels`.
 */
export async function twoFactorPanelCopy(): Promise<TwoFactorPanelCopy> {
  return twoFactorPanelCopyFrom(
    await getTranslations('settings.panels'),
    await getTranslations('auth'),
  );
}

export async function accountClosurePanelCopy(): Promise<AccountClosurePanelCopy> {
  return accountClosurePanelCopyFrom(
    await getTranslations('settings.panels'),
    await getTranslations('auth'),
  );
}

export async function dataExportPanelCopy(): Promise<DataExportPanelCopy> {
  return dataExportPanelCopyFrom(
    await getTranslations('settings.panels'),
    await getTranslations('auth'),
  );
}

/** §4.1's A-09 — the device list under `/settings/sessions`, and the row it repeats. */
export async function sessionsPanelCopy(): Promise<SessionsPanelCopy> {
  return sessionsPanelCopyFrom(
    await getTranslations('settings.panels'),
    await getTranslations('auth'),
  );
}

/**
 * Every word `/u/[slug]` draws — `profile-copy.ts` explains the two decisions in it.
 *
 * One object for the whole route rather than one per component: the grid is a client component
 * that renders the cards, so the card's vocabulary has to travel through it, and the tabs are
 * built by the page out of the same three words the panels are labelled with.
 */
export async function profileCopy(): Promise<ProfileCopy> {
  return profileCopyFrom(
    await getTranslations('profile'),
    await getTranslations('common'),
  );
}

/**
 * The editor that writes the profile above, and the switch that hides it — issue #82.
 *
 * The same namespace as the public side, which is the point: the two halves describe the same
 * six fields, and somebody who edits "Biography" should meet the word they saw on their own
 * profile. `profile-copy.ts` carries the rest.
 *
 * <p>Two accessors because two routes: `/settings/profile` draws the editor and
 * `/settings/privacy` draws the visibility switch beside the data export and the closure.
 */
export async function profileEditorCopy(): Promise<ProfileEditorCopy> {
  return profileEditorCopyFrom(await getTranslations('profile'));
}

export async function profileVisibilityCopy(): Promise<ProfileVisibilityCopy> {
  return profileVisibilityCopyFrom(await getTranslations('profile'));
}

/**
 * The words every campaign card draws — `lib/i18n/card-copy.ts` explains why they are a prop.
 *
 * Six surfaces render that card and each resolves this: the home page, the feed, the search
 * results, the category landings, the collection pages and the profile grid.
 */
export async function projectCardCopy(): Promise<ProjectCardCopy> {
  return projectCardCopyFrom(
    await getTranslations('discovery.card'),
    await getTranslations('common'),
  );
}

/**
 * Every word the discovery feed draws — `feed-copy.ts` explains why all of it is one prop.
 *
 * Three namespaces: the surface's own sentences, the closed vocabularies the filters are named
 * from, and the search box's. They are read separately elsewhere — `activeFilters` needs only
 * the vocabularies — and travel together because one route draws all three.
 */
export async function feedCopy(): Promise<FeedCopy> {
  return feedCopyFrom(
    await getTranslations('discovery.feed'),
    await getTranslations('discovery.filters'),
    await getTranslations('discovery.suggest'),
  );
}

/**
 * The administration console's frame — `admin-copy.ts` records the decision behind it.
 *
 * Two accessors because two routes need different halves: every console route renders the
 * bar and the rail, and only `/admin` renders the index that describes the sixteen modules.
 */
export async function adminShellCopy(): Promise<AdminShellCopy> {
  return adminShellCopyFrom(await getTranslations('admin'));
}

export async function consoleIndexCopy(): Promise<ConsoleIndexCopy> {
  return consoleIndexCopyFrom(await getTranslations('admin'));
}

/**
 * The notifications inbox and its settings — `notifications-copy.ts` explains the two tables.
 *
 * Two accessors because two routes render two panels: `/notifications` is the inbox and
 * `/settings/notifications` is the switchboard, and each shares the vocabulary of categories
 * and channels without needing the other's own sentences.
 */
export async function inboxCopy(): Promise<InboxCopy> {
  return inboxCopyFrom(await getTranslations('account.notifications'));
}

export async function notificationPreferencesCopy(): Promise<PreferencesCopy> {
  return preferencesCopyFrom(await getTranslations('account.notifications'));
}

/** The checkout's words. `checkout-copy.ts` explains why the whole of it is one prop. */
export async function checkoutCopy(): Promise<CheckoutCopy> {
  return checkoutCopyFrom(await getTranslations('checkout'));
}

/**
 * The panels below `/pledges` — issue #81.
 *
 * Two accessors because two routes render two panels, and the detail screen needs the editor's
 * words as well as its own. Neither carries the checkout's vocabulary: `/pledges/{id}` resolves
 * {@link checkoutCopy} beside this, because the editor is the checkout's own form over a pledge
 * that already exists and draws its field, its hints and its refusals from there.
 */
export async function pledgeListCopy(): Promise<PledgeListCopy> {
  return pledgeListCopyFrom(await getTranslations('account.pledges'));
}

export async function pledgeManagerCopy(): Promise<PledgeManagerCopy> {
  return pledgeManagerCopyFrom(await getTranslations('account.pledges'));
}

/**
 * The two lists under `/account/saved` and `/account/following` — issue #83.
 *
 * Each reads `common` as well as its own namespace, because the paginator's three words and
 * the way back to discovery belong to every list on the platform rather than to these two.
 * `signals-copy.ts` carries the rest of that decision.
 */
export async function savedListCopy(): Promise<SignalListCopy> {
  return savedListCopyFrom(
    await getTranslations('account.signals'),
    await getTranslations('common'),
  );
}

export async function followingListCopy(): Promise<SignalListCopy> {
  return followingListCopyFrom(
    await getTranslations('account.signals'),
    await getTranslations('common'),
  );
}

/**
 * The backer survey screens under `/account/surveys` — issue #84.
 *
 * One object for the list, the cards below it and the fields inside those: it is one screen,
 * and three accessors would be three reads of one namespace threaded through one tree.
 * `common` comes in for the empty state's way out, which every list on the platform shares.
 */
export async function surveysCopy(): Promise<SurveysCopy> {
  return surveysCopyFrom(
    await getTranslations('account.surveys'),
    await getTranslations('common'),
  );
}

/**
 * The public report dialog, wherever it is mounted — issue #85.
 *
 * It reads three namespaces, and the middle one is the point of the issue: the nine reasons
 * are `admin.moderation.reason`, the same table the console triages by, rather than a second
 * list that used to live in `lib/moderation/describe.ts` and be held still by a test.
 * `report-copy.ts` carries the argument.
 */
export async function reportControlCopy(): Promise<ReportControlCopy> {
  return reportControlCopyFrom(
    await getTranslations('moderation.report'),
    await getTranslations('admin.moderation'),
    await getTranslations('common'),
  );
}

/** The creator's payout details panel — IDN-EXT-01 (#44). */
export async function payoutPanelCopy(): Promise<PayoutPanelCopy> {
  return payoutPanelCopyFrom(await getTranslations('settings.panels.payout'));
}

/** The creator's Extend and Withdraw controls on the dashboard — IDN-EXT-01 (#44). */
export async function campaignControlsCopy(): Promise<CampaignControlsCopy> {
  return campaignControlsCopyFrom(await getTranslations('dashboardControls'));
}

/* -------------------------------------------------------------------------
 * The creator dashboard — issue #79, under epic #78
 *
 * One accessor per panel rather than one for the namespace. The five routes under
 * `/projects/[id]/dashboard` each render one client island, and handing the charts page the
 * survey builder's vocabulary would put every word of §4.8 into the flight payload of a
 * screen that draws a line and two bar charts. `dashboard-copy.ts` carries the rest.
 * ---------------------------------------------------------------------- */

/** The layout's metadata. `noindex, nofollow` — one creator's view of their own money. */
export async function dashboardMetaCopy(): Promise<DashboardMetaCopy> {
  return dashboardMetaCopyFrom(await getTranslations('dashboard'));
}

/** The way between the five panels, resolved by the layout that draws it. */
export async function dashboardNavCopy(): Promise<DashboardNavCopy> {
  return dashboardNavCopyFrom(await getTranslations('dashboard'));
}

/** CD-01: raised, backers, completion, and the countdown beneath them. */
export async function dashboardOverviewCopy(): Promise<DashboardOverviewCopy> {
  return dashboardOverviewCopyFrom(await getTranslations('dashboard'));
}

/** CD-02, CD-07 and CD-08: the funding trend, the reward mix, and where the backers are. */
export async function fundingChartsCopy(): Promise<FundingChartsCopy> {
  return fundingChartsCopyFrom(await getTranslations('dashboard'));
}

/** CD-10 and CD-11: the backer report, its saved segments, its table and its export. */
export async function backerReportCopy(): Promise<BackerReportCopy> {
  return backerReportCopyFrom(await getTranslations('dashboard'));
}

/** CD-16: gross, fees, tax, refunds, net, and §7.2's accounts under them. */
export async function financeCopy(): Promise<FinanceCopy> {
  return financeCopyFrom(await getTranslations('dashboard'));
}

/** §4.8's PM-01 to PM-04: the survey builder. */
export async function surveyBuilderCopy(): Promise<SurveyBuilderCopy> {
  return surveyBuilderCopyFrom(await getTranslations('dashboard'));
}

/** The pricing page and the plan chooser on it. */
export async function pricingCopy(): Promise<PricingCopy> {
  return pricingCopyFrom(await getTranslations('pricing'));
}

/** The save, share and reminder controls. */
export async function campaignActionsCopy(): Promise<CampaignActionsCopy> {
  return campaignActionsCopyFrom(await getTranslations('campaign.actions'));
}

/**
 * The funding block under §4.4's header — issue #99.
 *
 * Resolved by `CampaignSummary` rather than by the page, for the reason every other island on
 * that route is: whichever server component mounts a client component is the one that knows
 * what words it needs, and a page threading copy through a header it does not itself read is
 * a page that has to be edited whenever the header is.
 */
export async function liveFundingCopy(): Promise<LiveFundingCopy> {
  return liveFundingCopyFrom(await getTranslations('campaign'));
}

/** The composer and the two comment controls, which share one section. */
export async function commentCopy(): Promise<CommentCopy> {
  return commentCopyFrom(await getTranslations('campaign.comments'));
}

/**
 * The fixed steps of a `BreadcrumbList`, in the page's language — #123.
 *
 * Every route that emits structured data with a trail resolves this and hands it to its graph
 * builder. See `lib/i18n/trail-copy.ts` for why the markup is localised rather than left as
 * the English constants it was born with.
 */
export async function trailCopy(): Promise<TrailCopy> {
  return trailCopyFrom(await getTranslations('common.trail'));
}

/**
 * Everything a structured-data graph needs to name a page in its own language — #123.
 *
 * <p>The two travel together because every graph builder needs both and neither is useful
 * alone: the locale is what prefixes the URLs a crawler will follow, and the copy is what the
 * steps are called once it gets there. A route that resolved one and forgot the other would
 * emit a trail in Russian pointing at English pages, which is worse than either mistake on
 * its own.
 *
 * <p>`getLocale` rather than the route's `params`: `layout.tsx` calls `setRequestLocale` with
 * the segment, so this reads the value the router already resolved and leaves the render as
 * static as it found it. Reading a header or a cookie here would undo `i18n/routing.ts`.
 */
export async function graphContext(): Promise<{
  readonly locale: Locale;
  readonly trailCopy: TrailCopy;
}> {
  return { locale: localeOrDefault(await getLocale()), trailCopy: await trailCopy() };
}

/**
 * The campaign editor's frame — `lib/i18n/campaign-editor-copy.ts`.
 *
 * <p>Every one of the six tab pages resolves this and hands it to its panel, which threads it
 * into `EditorShell` and `SaveStatus`. It is the frame only: a panel's own field labels and
 * refusals belong to that panel, so translating one tab does not touch the other five.
 */
export async function editorChromeCopy(): Promise<EditorChromeCopy> {
  const [editor, counter, locale] = await Promise.all([
    getTranslations('campaignEditor'),
    getTranslations('common.characterCount'),
    getLocale(),
  ]);
  return editorChromeCopyFrom(editor, counter, localeOrDefault(locale));
}

/** The basics tab's own words — the first of the six panels. */
export async function basicsPanelCopy(): Promise<BasicsPanelCopy> {
  return basicsPanelCopyFrom(await getTranslations('campaignEditor'));
}

/** The rewards tab, the items list, and the two drawers they open. */
export async function rewardsPanelCopy(): Promise<RewardsPanelCopy> {
  const [editor, counter, locale] = await Promise.all([
    getTranslations('campaignEditor'),
    getTranslations('common.characterCount'),
    getLocale(),
  ]);
  return rewardsPanelCopyFrom(editor, localeOrDefault(locale), {
    remaining: counter.raw('remaining') as PluralForms,
    tooMany: counter.raw('tooMany') as PluralForms,
  });
}

/** The story tab, the block editor, the mark toolbar and the version history. */
export async function storyPanelCopy(): Promise<StoryPanelCopy> {
  const [editor, counter, locale] = await Promise.all([
    getTranslations('campaignEditor'),
    getTranslations('common.characterCount'),
    getLocale(),
  ]);
  return storyPanelCopyFrom(editor, localeOrDefault(locale), {
    remaining: counter.raw('remaining') as PluralForms,
    tooMany: counter.raw('tooMany') as PluralForms,
  });
}

/** The FAQ tab and the drawer one question is written in. */
export async function faqPanelCopy(): Promise<FaqPanelCopy> {
  const [editor, counter, locale] = await Promise.all([
    getTranslations('campaignEditor'),
    getTranslations('common.characterCount'),
    getLocale(),
  ]);
  return faqPanelCopyFrom(editor, localeOrDefault(locale), {
    remaining: counter.raw('remaining') as PluralForms,
    tooMany: counter.raw('tooMany') as PluralForms,
  });
}

/** The pre-launch tab — the page that goes public before the campaign does. */
export async function prelaunchPanelCopy(): Promise<PrelaunchPanelCopy> {
  const [editor, counter, locale] = await Promise.all([
    getTranslations('campaignEditor'),
    getTranslations('common.characterCount'),
    getLocale(),
  ]);
  return prelaunchPanelCopyFrom(editor, localeOrDefault(locale), {
    remaining: counter.raw('remaining') as PluralForms,
    tooMany: counter.raw('tooMany') as PluralForms,
  });
}

/** The review tab — what is left to do, and the two irreversible buttons. */
export async function reviewPanelCopy(): Promise<ReviewPanelCopy> {
  const [editor, locale] = await Promise.all([getTranslations('campaignEditor'), getLocale()]);
  return reviewPanelCopyFrom(editor, localeOrDefault(locale));
}

/** The one field that starts a campaign. */
export async function newProjectCopy(): Promise<NewProjectCopy> {
  return newProjectCopyFrom(await getTranslations('campaignEditor'));
}

/**
 * The six editor pages' descriptions.
 *
 * The titles are not here: they are the tabs' own names, so a page reads them from
 * {@link editorChromeCopy} rather than carrying a second spelling of "Basics".
 */
export async function editorMetaCopy(): Promise<EditorMetaCopy> {
  return editorMetaCopyFrom(await getTranslations('campaignEditor'));
}

/**
 * The public pre-launch page's words.
 *
 * Resolved by the route rather than the component, which is a client one: it reads the
 * campaign in the browser and holds a draft address. `prelaunch-copy.ts` carries the rest.
 */
export async function prelaunchCopy(): Promise<PrelaunchCopy> {
  return prelaunchCopyFrom(await getTranslations('campaign.prelaunch'));
}
