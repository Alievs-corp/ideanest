import type { PluralForms } from '@ideanest/ui';

/**
 * Every word the public pre-launch page draws — issue #324, §4.13.
 *
 * <h2>Why it is a prop, like the rest</h2>
 *
 * `PrelaunchView` is a client component: it reads the campaign in the browser, holds a draft
 * email address, and submits. `lib/i18n/shell-copy.ts` carries the measurement that made
 * `NextIntlClientProvider` the wrong answer for a surface like this one, and the answer it
 * reached is the one here: the server resolves the words once and hands down a plain object.
 *
 * <h2>Why this page had none of it</h2>
 *
 * It was missed rather than deferred. `apps/web/README.md` lists the surfaces still in English
 * and the pre-launch page was never among them — it is a public route, it is the link a
 * creator puts in a social post, and it was drawing twenty-two English literals on a page
 * whose shell around it was translated. That is the defect this module closes.
 *
 * <p>`waiting` is a plural rather than a template because the count is the subject of the
 * sentence and Russian needs three forms of it. It is resolved through
 * `lib/i18n/plurals.ts`, beside the number, and filled with `fillNodes` so the count keeps
 * the weight the design gives it.
 */
export interface PrelaunchCopy {
  /** Names the skeleton while the campaign is being read. */
  readonly loading: string;
  /**
   * The heading for the three states the service will not tell apart — no such campaign,
   * still a draft, already launched. The wording must never distinguish them; `PrelaunchView`
   * explains why.
   */
  readonly unavailableTitle: string;
  readonly unavailable: string;
  readonly alreadyOpen: string;
  readonly failedTitle: string;
  readonly comingSoon: string;
  /** Carries `{count}`. */
  readonly waiting: PluralForms;
  readonly formTitle: string;
  readonly formIntro: string;
  readonly accountAddress: string;
  readonly emailLabel: string;
  readonly emailPlaceholder: string;
  readonly emailInvalid: string;
  readonly submit: string;
  readonly submitting: string;
  readonly onListTitle: string;
  readonly onListSignedIn: string;
  readonly onListGuest: string;
  /** The same outcome for a screen reader, announced rather than read. */
  readonly onListAnnouncement: string;
  readonly errors: {
    readonly rateLimited: string;
    /** Carries `{minutes}`, known only when the service refuses. */
    readonly rateLimitedIn: string;
    readonly notSaved: string;
    readonly unreachable: string;
  };
}

/**
 * A message lookup, narrowed to what this builder needs.
 *
 * `raw` is required for the two keys that carry a placeholder or a plural: asking the
 * formatter for `errors.rateLimitedIn` without a value for `{minutes}` throws, and
 * `{count}` is filled beside the number rather than here. `checkout-copy.ts` carries the
 * same pair for the same reason.
 */
export interface PrelaunchTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

export function prelaunchCopyFrom(t: PrelaunchTranslator): PrelaunchCopy {
  return {
    loading: t('loading'),
    unavailableTitle: t('unavailableTitle'),
    unavailable: t('unavailable'),
    alreadyOpen: t('alreadyOpen'),
    failedTitle: t('failedTitle'),
    comingSoon: t('comingSoon'),
    waiting: t.raw('waiting') as PluralForms,
    formTitle: t('formTitle'),
    formIntro: t('formIntro'),
    accountAddress: t('accountAddress'),
    emailLabel: t('emailLabel'),
    emailPlaceholder: t('emailPlaceholder'),
    emailInvalid: t('emailInvalid'),
    submit: t('submit'),
    submitting: t('submitting'),
    onListTitle: t('onListTitle'),
    onListSignedIn: t('onListSignedIn'),
    onListGuest: t('onListGuest'),
    onListAnnouncement: t('onListAnnouncement'),
    errors: {
      rateLimited: t('errors.rateLimited'),
      rateLimitedIn: String(t.raw('errors.rateLimitedIn')),
      notSaved: t('errors.notSaved'),
      unreachable: t('errors.unreachable'),
    },
  };
}
