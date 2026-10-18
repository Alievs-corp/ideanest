'use client';

import { useEffect, useMemo, useState } from 'react';
import { Field, InlineAlert, Pill, Select, Skeleton, SkeletonGroup, Tag, Textarea, TextInput } from '@ideanest/ui';
import {
  EMAIL_LOCALES,
  editTemplate,
  missingPlaceholders,
  previewDraft,
  readTemplateDraft,
  readTemplateHistory,
  testSendDraft,
  unknownPlaceholders,
  withdrawTemplate,
  type EmailLocale,
  type EmailPreview,
  type EmailTemplateDraft,
  type EmailTemplateVersion,
} from '../../lib/admin/email-templates';
import { codedRefusalFor, refusalCode, refusalMeta } from '../../lib/admin/coded-refusal';
import { bakuDateTime } from '../../lib/admin/console-dates';
import { actionMessageFor } from '../../lib/admin/refusals';
import { ApiError } from '../../lib/api/problem';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { EmailTemplateEditorCopy } from '../../lib/i18n/admin/platform-copy';
import { Confirm } from './ConsoleConfirm';
import { EntityName } from './ConsoleIdentity';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

export interface EmailTemplateEditorProps {
  /** The `NotificationType` being edited, as the service names it. */
  readonly type: string;
  readonly copy: EmailTemplateEditorCopy;
}

/** The language the editor opens in: the platform's primary one. */
const PRIMARY: EmailLocale = 'az';

/**
 * §4.11's AD-15, third verb — §12.3, issue #315.
 *
 * <h2>One language at a time, and the screen says who it reaches</h2>
 *
 * An override belongs to one language. The selector picks it; everything beneath — the shipped
 * copy, the fields, the history — is that language's, and the screen says in a sentence which
 * recipients the text reaches. Switching with unsaved text asks first, because the text is
 * about to be thrown away.
 *
 * <h2>What may not be removed</h2>
 *
 * The administrator editing a payment-failure notice is exactly the person allowed to, so no
 * role check catches a notice that stops saying which card was declined. The shipped copy's
 * placeholders must survive — including the campaign's name, which nearly every recipient's
 * copy carries — and the screen names each by what it means, and the missing ones as somebody
 * types.
 *
 * <h2>Nothing goes live by accident</h2>
 *
 * Saving starts sending at once, so it asks inline first and names the version and the
 * language. Before that, the unsaved text can be previewed in a sandboxed frame — rendered by
 * the service's own composer, so it is the message rather than a picture of one — and sent to
 * the caller's own address.
 *
 * <h2>No motion</h2>
 *
 * A console screen; nothing animates.
 */
export function EmailTemplateEditor({ type, copy }: EmailTemplateEditorProps) {
  const [locale, setLocale] = useState<EmailLocale>(PRIMARY);
  const [pending, setPending] = useState<EmailLocale | null>(null);
  const [dirty, setDirty] = useState(false);

  function choose(next: EmailLocale): void {
    if (next === locale) return;
    if (dirty) {
      setPending(next);
      return;
    }
    setLocale(next);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Field label={copy.languageLabel} className="max-w-[280px]">
          <Select value={locale} onChange={(event) => choose(event.target.value as EmailLocale)}>
            {EMAIL_LOCALES.map((option) => (
              <option key={option} value={option}>
                {copy.language[option] ?? option}
              </option>
            ))}
          </Select>
        </Field>

        {pending !== null && (
          <Confirm
            label={copy.switchLabel}
            text={copy.switchConfirm}
            action={copy.switchAction}
            working={copy.switchAction}
            back={copy.back}
            busy={false}
            onConfirm={() => {
              setLocale(pending);
              setPending(null);
              setDirty(false);
            }}
            onBack={() => setPending(null)}
          />
        )}
      </div>

      {/* Keyed by the language, so nothing typed in one can be saved under another. */}
      <LanguageEditor key={locale} type={type} locale={locale} copy={copy} onDirtyChange={setDirty} />
    </div>
  );
}

/**
 * A refusal with its English prose replaced by the screen's own sentence.
 *
 * <p>`useConsoleResource` words a failed read with the service's `detail`, which is English. The
 * two refusals it renders itself — signed out, not permitted — are left alone; everything else
 * carries the sentence given here.
 */
function inReadersWords(cause: unknown, text: string): unknown {
  if (!(cause instanceof ApiError) || cause.status === 401 || cause.status === 403) return cause;
  return new ApiError(cause.status, { ...(cause.problem ?? {}), detail: text }, text);
}

type Asking = { readonly kind: 'save' } | { readonly kind: 'withdraw' } | { readonly kind: 'restore'; readonly from: EmailTemplateVersion };

function LanguageEditor({
  type,
  locale,
  copy,
  onDirtyChange,
}: {
  readonly type: string;
  readonly locale: EmailLocale;
  readonly copy: EmailTemplateEditorCopy;
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
  const readerLocale = useRouteLocale();

  const draft = useConsoleResource(
    async (signal) => {
      try {
        return await readTemplateDraft(type, locale, signal);
      } catch (cause) {
        throw inReadersWords(cause, copy.errors[refusalCode(cause) ?? ''] ?? copy.readFailed);
      }
    },
    copy.subject,
    copy.refusals,
    [type, locale],
  );
  const history = useConsoleResource(
    async (signal) => {
      try {
        return await readTemplateHistory(type, locale, signal);
      } catch (cause) {
        throw inReadersWords(cause, copy.refusals.refused);
      }
    },
    copy.historySubject,
    copy.refusals,
    [type, locale],
  );

  const versions = history.data?.versions ?? [];
  const names = useDirectoryNames(versions.map((version) => version.createdBy), []);

  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<'preview' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [preview, setPreview] = useState<{ readonly email: EmailPreview; readonly subject: string; readonly body: string } | null>(null);

  const data = draft.data;
  const language = copy.language[locale] ?? locale;

  // The fields start from what is live in this language — the override, or the shipped copy as
  // nearly every recipient gets it, which is the campaign-named variant when there is one.
  const startSubject = data?.override?.subject ?? data?.shippedSubjectNamed ?? data?.shippedSubject ?? '';
  const startBody = data?.override?.body ?? data?.shippedBodyNamed ?? data?.shippedBody ?? '';
  const currentSubject = subject ?? startSubject;
  const currentBody = body ?? startBody;
  const isDirty = data !== null && (currentSubject !== startSubject || currentBody !== startBody);

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const required = data?.requiredPlaceholders ?? [];
  const available = data?.availablePlaceholders ?? required;
  const missing = useMemo(() => missingPlaceholders(required, currentSubject, currentBody), [required, currentSubject, currentBody]);
  const unknown = useMemo(() => unknownPlaceholders(available, currentSubject, currentBody), [available, currentSubject, currentBody]);

  if (draft.status === 'signed-out' || draft.status === 'forbidden') {
    return <ConsoleRefusal status={draft.status} capability={draft.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (data === null) {
    if (draft.status === 'failed') {
      return (
        <div>
          <InlineAlert variant="danger" title={copy.errorTitle}>
            {draft.error ?? copy.readFailed}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={draft.reload}>
            {copy.tryAgain}
          </Pill>
        </div>
      );
    }
    return (
      <SkeletonGroup label={copy.loadingList}>
        <Skeleton height="1rem" width="40%" />
        <Skeleton height="5rem" width="100%" className="mt-4" />
      </SkeletonGroup>
    );
  }

  const describe = (indices: readonly string[]) =>
    indices.map((index) => `{${index}} — ${copy.placeholder[index] ?? ''}`.trim()).join(', ');

  /** A refused write, worded by the screen. Never the service's English. */
  function refusalOf(cause: unknown): string {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      return actionMessageFor(cause, copy.subject, copy.refusals);
    }
    const code = refusalCode(cause);
    if (code === 'MISSING_TEMPLATE_PLACEHOLDER' && cause instanceof ApiError) {
      const listed = cause.problem?.meta?.['missing'];
      const indices = Array.isArray(listed) ? listed.map(String) : [];
      return fillPlaceholders(copy.missingBody, { placeholders: describe(indices) });
    }
    if (code === 'TEMPLATE_COPY_MALFORMED') {
      const placeholder = refusalMeta(cause, 'placeholder');
      if (refusalMeta(cause, 'reason') === 'UNKNOWN_PLACEHOLDER' && placeholder !== undefined) {
        return fillPlaceholders(copy.unknownBody, { placeholders: `{${placeholder}}` });
      }
      const field = refusalMeta(cause, 'field') === 'subject' ? copy.field.subject : copy.field.body;
      return fillPlaceholders(copy.malformedBody, { field, example: '{2}' });
    }
    return codedRefusalFor(cause, copy.errors, copy.errors['INVALID_REQUEST'] ?? copy.refusals.refused, copy.subject, copy.refusals);
  }

  async function act(work: () => Promise<void>, what: 'preview' | 'test' | null = null): Promise<void> {
    setBusy(true);
    setWorking(what);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (cause) {
      setError(refusalOf(cause));
    } finally {
      setBusy(false);
      setWorking(null);
      setAsking(null);
    }
  }

  const loaded: EmailTemplateDraft = data;
  const nextVersion = (versions[0]?.version ?? data.override?.version ?? 0) + 1;
  const blank = currentSubject.trim() === '' || currentBody.trim() === '';
  const savable = !blank && missing.length === 0 && unknown.length === 0;
  const draftCopy = { locale, subject: currentSubject.trim(), body: currentBody.trim() };

  async function save(text: { subject: string; body: string }, why: string | null, said: (version: number) => string) {
    const written = await editTemplate(type, locale, text.subject, text.body, why);
    draft.set({ ...loaded, override: written });
    setSubject(null);
    setBody(null);
    setNote('');
    setDone(said(written.version));
    history.reload();
  }

  const overridden = data.override != null;
  const named = data.shippedSubjectNamed != null || data.shippedBodyNamed != null;
  const previewStale = preview !== null && (preview.subject !== draftCopy.subject || preview.body !== draftCopy.body);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="max-w-[62ch] text-sm text-white/80">
          {fillPlaceholders(copy.reach, { language })}
          {locale === PRIMARY && <> {copy.reachPrimary}</>}
        </p>
        <InlineAlert variant={overridden ? 'warning' : 'info'} title={overridden ? copy.overriddenTitle : copy.shippedTitle}>
          {overridden
            ? fillPlaceholders(copy.overriddenBody, { version: String(data.override?.version ?? ''), language })
            : copy.shippedBody}
        </InlineAlert>
      </div>

      <section aria-labelledby="shipped-heading">
        <h2 id="shipped-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.shippedHeading}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {named && (
            <ShippedBlock
              label={copy.shippedNamedLabel}
              subject={data.shippedSubjectNamed ?? data.shippedSubject}
              body={data.shippedBodyNamed ?? data.shippedBody}
            />
          )}
          <ShippedBlock label={named ? copy.shippedPlainLabel : null} subject={data.shippedSubject} body={data.shippedBody} />
        </div>
      </section>

      <section aria-labelledby="edit-heading">
        <h2 id="edit-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.yourHeading}
        </h2>

        <div className="mt-3 rounded-lg border border-white/8 p-4">
          <h3 className="text-sm font-medium text-white">{copy.placeholdersHeading}</h3>
          <p className="mt-1 max-w-[62ch] text-xs text-white/64">{copy.placeholdersIntro}</p>
          <ul className="mt-2 flex list-none flex-col gap-1">
            {available.map((index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 text-sm text-white/80">
                <code className="font-mono text-white">{`{${index}}`}</code>
                <span>— {copy.placeholder[index] ?? ''}</span>
                {required.includes(index) && <Tag>{copy.mustKeep}</Tag>}
              </li>
            ))}
          </ul>
          {required.includes('1') && (
            <p className="mt-2 max-w-[62ch] text-xs text-white/64">
              {fillPlaceholders(copy.campaignFallback, { placeholder: '{1}' })}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Field label={copy.subjectLabel}>
            <TextInput value={currentSubject} onChange={(event) => setSubject(event.target.value)} maxLength={300} />
          </Field>

          <Field label={copy.bodyLabel}>
            <Textarea rows={5} value={currentBody} onChange={(event) => setBody(event.target.value)} maxLength={50000} />
          </Field>

          <Field label={copy.whyLabel} hint={copy.whyHint}>
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
          </Field>
        </div>

        {missing.length > 0 && (
          <InlineAlert variant="danger" title={copy.missingTitle} className="mt-4">
            {fillPlaceholders(copy.missingBody, { placeholders: describe(missing) })}
          </InlineAlert>
        )}
        {unknown.length > 0 && (
          <InlineAlert variant="danger" title={copy.unknownTitle} className="mt-4">
            {fillPlaceholders(copy.unknownBody, { placeholders: unknown.map((index) => `{${index}}`).join(', ') })}
          </InlineAlert>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Pill
            variant="ghost"
            size="sm"
            disabled={busy || blank}
            onClick={() =>
              void act(async () => {
                const email = await previewDraft(type, draftCopy);
                setPreview({ email, subject: draftCopy.subject, body: draftCopy.body });
              }, 'preview')
            }
          >
            {working === 'preview' ? copy.previewing : copy.preview}
          </Pill>
          <Pill
            variant="ghost"
            size="sm"
            disabled={busy || blank}
            onClick={() =>
              void act(async () => {
                await testSendDraft(type, draftCopy);
                setDone(copy.testSent);
              }, 'test')
            }
          >
            {working === 'test' ? copy.testSending : copy.testSend}
          </Pill>
          <Pill variant="outline" size="sm" disabled={busy || !savable} onClick={() => setAsking({ kind: 'save' })}>
            {copy.saveNew}
          </Pill>
          {overridden && (
            <Pill variant="ghost" size="sm" disabled={busy} onClick={() => setAsking({ kind: 'withdraw' })}>
              {copy.withdraw}
            </Pill>
          )}
        </div>

        {asking?.kind === 'save' && (
          <div className="mt-3">
            <Confirm
              label={copy.confirmSaveLabel}
              text={fillPlaceholders(copy.confirmSave, { version: String(nextVersion), language })}
              action={copy.confirmSaveAction}
              working={copy.saving}
              back={copy.back}
              busy={busy}
              onConfirm={() =>
                void act(() =>
                  save(draftCopy, note.trim() === '' ? null : note.trim(), (version) =>
                    fillPlaceholders(copy.savedNew, { version: String(version) }),
                  ),
                )
              }
              onBack={() => setAsking(null)}
            />
          </div>
        )}
        {asking?.kind === 'withdraw' && (
          <div className="mt-3">
            <Confirm
              label={copy.confirmWithdrawLabel}
              text={fillPlaceholders(copy.confirmWithdraw, { version: String(data.override?.version ?? ''), language })}
              action={copy.withdraw}
              working={copy.saving}
              back={copy.back}
              busy={busy}
              onConfirm={() =>
                void act(async () => {
                  await withdrawTemplate(type, locale);
                  draft.set({ ...data, override: null });
                  setSubject(null);
                  setBody(null);
                  setDone(copy.savedWithdrawn);
                  history.reload();
                })
              }
              onBack={() => setAsking(null)}
            />
          </div>
        )}

        {done !== null && (
          <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
            {done}
          </InlineAlert>
        )}
        {error !== null && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {error}
          </InlineAlert>
        )}
      </section>

      {preview !== null && (
        <section aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
            {copy.previewHeading}
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.previewIntro}</p>
          {previewStale && <p className="mt-2 text-sm text-white/80">{copy.previewStale}</p>}
          <p className="mt-3 text-sm text-white">{fillPlaceholders(copy.previewSubject, { subject: preview.email.subject })}</p>
          {/* No permissions at all: the HTML is the service's, but a frame that could run script or
              read this origin would be a console page running markup out of a database row. */}
          <iframe
            title={copy.previewFrameTitle}
            sandbox=""
            srcDoc={preview.email.html}
            className="mt-3 h-[520px] w-full rounded-lg border border-white/12"
          />
        </section>
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.versionsHeading}
        </h2>

        {history.status === 'failed' && history.data === null && (
          <div className="mt-3">
            <InlineAlert variant="danger" title={copy.errorTitle}>
              {history.error ?? copy.refusals.refused}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-3" onClick={history.reload}>
              {copy.tryAgain}
            </Pill>
          </div>
        )}

        {history.data !== null && versions.length === 0 && <p className="mt-3 text-sm text-white/64">{copy.versionsEmpty}</p>}

        {versions.length > 0 && (
          <ul className="mt-3 flex list-none flex-col gap-2">
            {versions.map((version) => (
              <li key={version.id} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-white/80">
                    {fillPlaceholders(copy.versionLine, {
                      version: String(version.version),
                      date: version.createdAt == null ? '' : bakuDateTime(version.createdAt, readerLocale),
                    })}
                  </p>
                  {version.live && <Tag variant="success">{copy.live}</Tag>}
                </div>
                <p className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-white/64">
                  <span>{copy.writtenBy}</span>
                  <EntityName id={version.createdBy} names={names} kind="account" copy={copy.identity} />
                </p>
                <p className="mt-2 text-sm text-white">{version.subject}</p>
                {version.note != null && version.note !== '' && <p className="mt-1 text-xs text-white/64">{version.note}</p>}
                <details className="mt-2">
                  <summary className="cursor-pointer rounded text-sm text-white/80 underline decoration-white/24 underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]">
                    {copy.showText}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-white/64">{version.body}</p>
                </details>
                {!version.live && (
                  <div className="mt-3">
                    {asking?.kind === 'restore' && asking.from.id === version.id ? (
                      <Confirm
                        label={copy.confirmRestoreLabel}
                        text={fillPlaceholders(copy.confirmRestore, { from: String(version.version), version: String(nextVersion) })}
                        action={copy.restore}
                        working={copy.saving}
                        back={copy.back}
                        busy={busy}
                        onConfirm={() =>
                          void act(() =>
                            save(
                              { subject: version.subject, body: version.body },
                              fillPlaceholders(copy.restoredNote, { version: String(version.version) }),
                              (written) => fillPlaceholders(copy.savedNew, { version: String(written) }),
                            ),
                          )
                        }
                        onBack={() => setAsking(null)}
                      />
                    ) : (
                      <Pill variant="ghost" size="sm" disabled={busy} onClick={() => setAsking({ kind: 'restore', from: version })}>
                        {copy.restore}
                      </Pill>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShippedBlock({ label, subject, body }: { readonly label: string | null; readonly subject: string; readonly body: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-surface-1 p-4">
      {label !== null && <p className="mb-2 text-xs text-white/64">{label}</p>}
      <p className="text-sm text-white/80">{subject}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-white/64">{body}</p>
    </div>
  );
}
