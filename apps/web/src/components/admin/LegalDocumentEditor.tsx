'use client';

import { useState } from 'react';
import {
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  Tag,
  Textarea,
  TextInput,
} from '@ideanest/ui';
import {
  DOCUMENT_KINDS,
  DOCUMENT_LOCALES,
  activateVersion,
  publishDocument,
  readDocumentHistory,
  writeDraft,
  type DocumentKind,
  type DocumentLocale,
} from '../../lib/admin/legal';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { LegalDocumentEditorCopy } from '../../lib/i18n/admin/platform-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/** The language that governs. Nothing publishes without it. */
const GOVERNING: DocumentLocale = 'az';

/**
 * §22.2's eight documents, drafted and published — issue #425.
 *
 * <h2>The screen has to make the irreversibility obvious rather than warn about it</h2>
 *
 * `FeeEditor` faces the same problem and answers it the same way. An operator opening this
 * expects to change a document; what actually happens is that a new version is written and
 * the old one stays readable forever, because an acceptance names a version and an
 * acceptance of a text that can be edited afterwards is evidence of nothing.
 *
 * Two things carry that here, and neither is a dialog. **Saving and publishing are separate
 * controls**, so the irreversible one is never the default — an editor that published on
 * save would make the unrecoverable action the one somebody reaches by habit. And the
 * published versions stay on the screen beneath the draft, so the growing list is the
 * feedback: an operator who "edited" three times sees three versions and understands the
 * model without reading a warning.
 *
 * <h2>One language at a time to write, all of them at once to publish</h2>
 *
 * Somebody writes in one language. But a version is published in every language it has been
 * translated into, under one number and one effective date, because a publication that could
 * half-happen would leave days in which what a reader agreed to and what governed them were
 * different documents.
 *
 * So the locale switcher moves the editor between drafts, and the publish control names the
 * languages it is about to publish. Nothing publishes without the Azerbaijani text — the
 * service refuses it with `GOVERNING_TEXT_MISSING`, and this screen says so before the
 * request rather than after.
 *
 * <h2>No motion</h2>
 *
 * Nothing here animates, and there is no scroll-entry effect on the version list. This is a
 * console screen whose one action cannot be taken back; docs/motion-system.md §5 gives
 * administrative surfaces the smallest budget on the platform, and a list that faded in
 * would be movement on the screen where somebody is deciding.
 */
export interface LegalDocumentEditorProps {
  readonly copy: LegalDocumentEditorCopy;
}

export function LegalDocumentEditor({ copy }: LegalDocumentEditorProps) {
  const [kind, setKind] = useState<DocumentKind>('TERMS_OF_USE');
  const [locale, setLocale] = useState<DocumentLocale>(GOVERNING);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const history = useConsoleResource(
    (signal) => readDocumentHistory(kind, signal),
    copy.subject,
    copy.refusals,
    [kind],
  );

  if (history.status === 'signed-out' || history.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={history.status}
        capability={history.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  /*
   * The draft the switcher is pointing at, loaded into the fields once per (kind, locale).
   *
   * Keyed rather than done in an effect, and the key is what makes it safe: `loaded` records
   * which draft the fields hold, so switching language loads the other one and typing does
   * not get overwritten by a re-render. An effect on [kind, locale] would fight the operator
   * for the cursor every time the resource reloaded.
   */
  const draft = history.data?.drafts.find((entry) => entry.locale === locale) ?? null;
  const key = `${kind}:${locale}`;
  if (history.status === 'ready' && loaded !== key) {
    setLoaded(key);
    setTitle(draft?.title ?? '');
    setBody(draft?.body ?? '');
  }

  const drafted = history.data?.drafts.map((entry) => entry.locale) ?? [];
  const governingDrafted = drafted.includes(GOVERNING);
  const versions = history.data?.versions ?? [];
  const inForceVersion = history.data?.inForceVersion ?? null;

  async function save(): Promise<void> {
    if (title.trim() === '' || body.trim() === '') return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const written = await writeDraft({ kind, locale, title: title.trim(), body: body.trim() });
      setDone(fillPlaceholders(copy.savedNotice, { locale, version: String(written.version) }));
      history.reload();
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const published = await publishDocument({
        kind,
        /*
         * Empty means now. A date is taken as a plain calendar day and sent as the start of
         * that day in UTC — the service refuses anything already past, which is what stops a
         * date typed as yesterday claiming to have bound people before they could read it.
         */
        effectiveFrom: effectiveFrom === '' ? null : new Date(`${effectiveFrom}T00:00:00Z`).toISOString(),
      });

      const first = published.documents[0];
      setDone(
        fillPlaceholders(copy.publishedNotice, {
          version: String(first?.version ?? ''),
          languages: published.documents.map((entry) => entry.locale).join(', '),
        }),
      );
      setEffectiveFrom('');
      setLoaded(null);
      history.reload();
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  async function activate(version: number): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await activateVersion(kind, version);
      setDone(fillPlaceholders(copy.activatedNotice, { version: String(version) }));
      history.reload();
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={copy.documentLabel} className="min-w-[280px]">
          <Select value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)}>
            {DOCUMENT_KINDS.map((option) => (
              <option key={option} value={option}>
                {copy.kind[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={copy.languageLabel} hint={copy.languageHint} className="min-w-[200px]">
          <Select
            value={locale}
            onChange={(event) => setLocale(event.target.value as DocumentLocale)}
          >
            {DOCUMENT_LOCALES.map((option) => (
              <option key={option} value={option}>
                {copy.locale[option]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle}>
          {error}
        </InlineAlert>
      )}

      {done !== null && (
        <InlineAlert variant="success" title={copy.doneTitle}>
          {done}
        </InlineAlert>
      )}

      <section aria-labelledby="legal-draft-heading">
        <h2 id="legal-draft-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.draftHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.draftIntro}</p>

        {history.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="0.875rem" width="60%" className="mt-3" />
          </SkeletonGroup>
        )}

        {history.status === 'ready' && (
          <div className="mt-4 flex flex-col gap-3">
            <Field label={copy.titleLabel}>
              <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>

            <Field label={copy.bodyLabel} hint={copy.bodyHint}>
              <Textarea rows={16} value={body} onChange={(event) => setBody(event.target.value)} />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              {/*
                Saving is `ghost` and publishing is `primary`, and neither is `accent`. §8.5
                keeps lime for urgency, and this is not urgent — it is irreversible, which is
                a different thing and reads as a different weight.
              */}
              <Pill
                variant="ghost"
                onClick={() => void save()}
                disabled={busy || title.trim() === '' || body.trim() === ''}
              >
                {busy ? copy.working : copy.save}
              </Pill>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="legal-publish-heading">
        <h2
          id="legal-publish-heading"
          className="text-lg font-medium tracking-[-0.02em] text-white"
        >
          {copy.publishHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.publishIntro}</p>

        {history.status === 'ready' && drafted.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.nothingDraftedTitle}
            description={copy.nothingDraftedBody}
          />
        )}

        {history.status === 'ready' && drafted.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-white/64">
              {fillPlaceholders(copy.willPublish, {
                languages: drafted.map((entry) => copy.locale[entry as DocumentLocale]).join(', '),
              })}
            </p>

            {/*
              Stated before the request rather than after it. The service refuses this with
              GOVERNING_TEXT_MISSING, and an operator who has spent an afternoon on the
              English text should not learn at the last control that it was never publishable.
            */}
            {!governingDrafted && (
              <InlineAlert variant="warning" title={copy.governingMissingTitle}>
                {copy.governingMissingBody}
              </InlineAlert>
            )}

            <Field label={copy.effectiveFromLabel} hint={copy.effectiveFromHint} className="max-w-[280px]">
              <TextInput
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </Field>

            <div>
              <Pill variant="primary" onClick={() => void publish()} disabled={busy || !governingDrafted}>
                {busy ? copy.working : copy.publish}
              </Pill>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="legal-history-heading">
        <h2
          id="legal-history-heading"
          className="text-lg font-medium tracking-[-0.02em] text-white"
        >
          {copy.historyHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.historyIntro}</p>

        {history.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
              {history.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={history.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {history.status === 'ready' && versions.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.noVersionsTitle}
            description={copy.noVersionsBody}
          />
        )}

        {history.status === 'ready' && versions.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {versions.map((version) => (
              <li
                key={`${version.locale}-${version.version}`}
                className="flex flex-col gap-1 rounded-lg border border-white/12 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {fillPlaceholders(copy.versionLabel, { version: String(version.version) })}
                  </span>
                  <Tag>{copy.locale[version.locale as DocumentLocale] ?? version.locale}</Tag>
                  {version.version === inForceVersion && (
                    <Tag variant="success">{copy.shownOnSite}</Tag>
                  )}
                  {version.version !== inForceVersion && version.locale === GOVERNING && (
                    <Pill
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => void activate(version.version)}
                      disabled={busy}
                    >
                      {copy.showOnSite}
                    </Pill>
                  )}
                </div>
                <p className="text-sm text-white/64">{version.title}</p>
                <p className="text-[13px] text-white/40">
                  {fillPlaceholders(copy.versionMeta, {
                    from: version.effectiveFrom?.slice(0, 10) ?? '',
                    /*
                      Twelve characters of the digest, which is what git settled on for the
                      same problem: enough to compare two by eye, short enough to read out.
                      The whole hash is on the public route for anybody checking properly.
                    */
                    hash: version.contentHash.slice(0, 12),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
