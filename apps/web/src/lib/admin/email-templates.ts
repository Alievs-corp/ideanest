import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's AD-15, third verb: editing the copy the platform sends — §12.3, issue #315.
 *
 * <h2>What #315 was blocked on, and what the answer turned out to be</h2>
 *
 * "No template store, and no answer to who may rewrite a payment-failure notice." The store
 * is V52. The second half has two parts and only one of them is a role:
 *
 * - **Who.** `CONFIGURE_PLATFORM`, which only an administrator holds.
 * - **What may not be removed.** A payment-failure notice that no longer says which card was
 *   declined is worse than no override at all, and *no role check catches that* — the
 *   administrator editing it is exactly the person allowed to. So the shipped copy's
 *   placeholders are extracted and an override must keep every one of them.
 *
 * <h2>One language at a time</h2>
 *
 * An override belongs to one of the four languages. A recipient gets the live override for
 * their language when there is one and that language's shipped copy otherwise, so every call
 * here takes the locale it is about.
 *
 * <h2>The subject and the first paragraph, and nothing else</h2>
 *
 * The headline, the button label and a type's conditional second paragraph stay in the
 * shipped catalogue. A button with no label is a broken email rather than a badly worded one,
 * and a second paragraph that only appears for some recipients is copy an editor cannot see
 * the effect of.
 */

/** The languages a template can be rewritten in. The first is the platform's primary one. */
export const EMAIL_LOCALES = ['az', 'en', 'ru', 'tr'] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** One language's live override, as the list reports it. */
export interface TemplateOverride {
  locale: string;
  liveVersion: number;
}

/** One notification type, as `GET /v1/admin/email-templates` lists it. */
export interface TemplateSummary {
  type: string;
  category: string;
  /** Whether a recipient can switch it off. Only the account-security notice cannot be. */
  mandatory: boolean;
  /** The languages somebody has rewritten it in. Empty, or absent, when all send the shipped copy. */
  overrides?: TemplateOverride[] | null;
}

export interface TemplateList {
  templates: TemplateSummary[];
}

/** One stored version. Nothing is edited in place; each edit appends. */
export interface EmailTemplateVersion {
  id: string;
  templateKey: string;
  locale: string;
  version: number;
  subject: string;
  body: string;
  requiredPlaceholders: string[];
  /** Exactly one version per template and locale may be live. */
  live: boolean;
  note?: string | null;
  createdAt?: string | null;
  createdBy: string;
}

/**
 * What the editor opens with, in one language.
 *
 * Both the shipped copy and the override, because an editor showing only the current text
 * gives nobody a way to see what they changed it from — and the shipped copy is also the
 * preview of withdrawing the override.
 */
export interface EmailTemplateDraft {
  type: string;
  locale: string;
  /** The subject a message with no campaign name gets. */
  shippedSubject: string;
  shippedBody: string;
  /** The subject naming the campaign — what nearly every recipient gets. Absent when the type has none. */
  shippedSubjectNamed?: string | null;
  shippedBodyNamed?: string | null;
  /** The `{n}` indices an override must keep, across both variants. */
  requiredPlaceholders: string[];
  /** The `{n}` indices an override may use: the facts this message carries. */
  availablePlaceholders?: string[] | null;
  /** Null when the platform is sending the shipped copy in this language. */
  override?: EmailTemplateVersion | null;
}

export interface EmailTemplateHistory {
  versions: EmailTemplateVersion[];
}

/** Unsaved text rendered as the email it would be. */
export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
}

/** Text the editor holds and has not saved. */
export interface DraftCopy {
  readonly locale: EmailLocale;
  readonly subject: string;
  readonly body: string;
}

function base(type: string): string {
  return `/v1/admin/email-templates/${encodeURIComponent(type)}`;
}

/** Every emailed template, with the languages each has been rewritten in. */
export async function readTemplateList(signal?: AbortSignal): Promise<TemplateList> {
  const response = await authorizedFetch('/v1/admin/email-templates', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as TemplateList;
}

/** The shipped copy in one language, the override if there is one, and the placeholders that must stay. */
export async function readTemplateDraft(
  type: string,
  locale: EmailLocale,
  signal?: AbortSignal,
): Promise<EmailTemplateDraft> {
  const response = await authorizedFetch(`${base(type)}/copy?locale=${locale}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as EmailTemplateDraft;
}

/** Every version ever written in one language, newest first. */
export async function readTemplateHistory(
  type: string,
  locale: EmailLocale,
  signal?: AbortSignal,
): Promise<EmailTemplateHistory> {
  const response = await authorizedFetch(`${base(type)}/versions?locale=${locale}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as EmailTemplateHistory;
}

/** Writes a new version in one language and makes it live. */
export async function editTemplate(
  type: string,
  locale: EmailLocale,
  subject: string,
  body: string,
  note: string | null,
  signal?: AbortSignal,
): Promise<EmailTemplateVersion> {
  const response = await authorizedFetch(`${base(type)}/copy?locale=${locale}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, body, note }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as EmailTemplateVersion;
}

/** Takes one language's override out of service, so its shipped copy renders again. The versions stay. */
export async function withdrawTemplate(type: string, locale: EmailLocale, signal?: AbortSignal): Promise<void> {
  const response = await authorizedFetch(`${base(type)}/copy?locale=${locale}`, { method: 'DELETE', signal });
  if (!response.ok) throw await errorFrom(response);
}

/** Renders unsaved text on the sample document. Nothing is stored. */
export async function previewDraft(type: string, draft: DraftCopy, signal?: AbortSignal): Promise<EmailPreview> {
  const response = await authorizedFetch(`${base(type)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as EmailPreview;
}

/** Sends unsaved text to the caller's own address — the service takes no recipient. */
export async function testSendDraft(type: string, draft: DraftCopy, signal?: AbortSignal): Promise<void> {
  const response = await authorizedFetch(`${base(type)}/test-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
}

/**
 * A placeholder as the service counts one: a bare number in braces.
 *
 * `{2,number}` is not one — the service refuses a format inside a placeholder, because every
 * fact arrives already formatted — so it does not count as keeping `{2}` either.
 */
const PLACEHOLDER = /\{(\d+)\}/g;

/** Every argument index used across a subject and a body, in numeric order. */
export function placeholdersIn(subject: string, body: string): string[] {
  const found = new Set<string>();
  for (const text of [subject, body]) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const index = match[1];
      if (index !== undefined) found.add(String(Number(index)));
    }
  }
  return [...found].sort((left, right) => Number(left) - Number(right));
}

/**
 * Which required placeholders a draft has dropped.
 *
 * Checked in the browser so the editor can say so as somebody types, and checked again in
 * the service because a browser check is a courtesy rather than a rule. Empty means the
 * service will accept it on this count.
 */
export function missingPlaceholders(required: readonly string[], subject: string, body: string): string[] {
  const present = new Set(placeholdersIn(subject, body));
  return required.filter((index) => !present.has(index));
}

/** Placeholders the draft uses that this message has no fact for. The service refuses them too. */
export function unknownPlaceholders(available: readonly string[], subject: string, body: string): string[] {
  const allowed = new Set(available);
  return placeholdersIn(subject, body).filter((index) => !allowed.has(index));
}
