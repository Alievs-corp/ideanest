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
import type { PluralForms } from '@ideanest/ui';
import {
  type BasicsPanelCopy,
  type EditorChromeCopy,
  type EditorMetaCopy,
  type NewProjectCopy,
  type RewardsPanelCopy,
  basicsPanelCopyFrom,
  editorChromeCopyFrom,
  editorMetaCopyFrom,
  newProjectCopyFrom,
  rewardsPanelCopyFrom,
} from './campaign-editor-copy';
import {
  type CampaignActionsCopy,
  type CommentCopy,
  campaignActionsCopyFrom,
  commentCopyFrom,
} from './campaign-copy';
import { localeOrDefault, type Locale } from './locale';
import { type ProfileCopy, profileCopyFrom } from './profile-copy';
import {
  type InboxCopy,
  type PreferencesCopy,
  inboxCopyFrom,
  preferencesCopyFrom,
} from './notifications-copy';
import { type ProjectCardCopy, projectCardCopyFrom } from './card-copy';
import { type FeedCopy, feedCopyFrom } from './feed-copy';
import {
  type AdminShellCopy,
  type ConsoleIndexCopy,
  adminShellCopyFrom,
  consoleIndexCopyFrom,
} from './admin-copy';
import {
  type EmailChangePanelCopy,
  type PasswordChangePanelCopy,
  emailChangePanelCopyFrom,
  passwordChangePanelCopyFrom,
} from './settings-copy';
import { type TrailCopy } from '../seo/structured-data/breadcrumb';
import { trailCopyFrom } from './trail-copy';
import {
  type FailureCopy,
  type FooterCopy,
  type ShellCopy,
  failureCopyFrom,
  footerCopyFrom,
  shellCopyFrom,
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

export async function failureCopy(): Promise<FailureCopy> {
  return failureCopyFrom(await getTranslations('shell'));
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

/** The pricing page and the plan chooser on it. */
export async function pricingCopy(): Promise<PricingCopy> {
  return pricingCopyFrom(await getTranslations('pricing'));
}

/** The save, share and reminder controls. */
export async function campaignActionsCopy(): Promise<CampaignActionsCopy> {
  return campaignActionsCopyFrom(await getTranslations('campaign.actions'));
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
