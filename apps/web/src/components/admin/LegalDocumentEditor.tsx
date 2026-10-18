'use client';

import { useEffect, useState } from 'react';
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
import { LEGAL_DOCUMENTS, kindOf, legalPath } from '@ideanest/legal/documents';
import { Link } from '../../i18n/navigation';
import {
  DOCUMENT_KINDS,
  DOCUMENT_LOCALES,
  activateVersion,
  publishDocument,
  readDocumentHistory,
  writeDraft,
  type DocumentHistory,
  type DocumentKind,
  type DocumentLocale,
  type DocumentSummary,
} from '../../lib/admin/legal';
import { codedRefusalFor, refusalCode } from '../../lib/admin/coded-refusal';
import { bakuDate, calendarDate } from '../../lib/admin/console-dates';
import { actionMessageFor } from '../../lib/admin/refusals';
import { ApiError } from '../../lib/api/problem';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { LegalDocumentEditorCopy } from '../../lib/i18n/admin/platform-copy';
import { Confirm } from './ConsoleConfirm';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/** The language that governs. Nothing publishes without it. */
const GOVERNING: DocumentLocale = 'az';

/** Baku is UTC+4 all year, so a day there starts at this offset. */
const BAKU_OFFSET = '+04:00';

/**
 * §22.2's eight documents, drafted and published — issue #425.
 *
 * <h2>The screen has to make the irreversibility obvious rather than warn about it</h2>
 *
 * An operator opening this expects to change a document; what actually happens is that a new
 * version is written and the old one stays readable forever, because an acceptance names a
 * version and an acceptance of a text that can be edited afterwards is evidence of nothing.
 *
 * **Saving and publishing are separate controls**, so the irreversible one is never the
 * default; the published versions stay on the screen beneath the draft; and **publishing and
 * choosing a version each ask first**, inline, in a sentence that names the document, the
 * version, the languages and the date in words — and, for the two agreements, who will have to
 * accept it again.
 *
 * <h2>One document at a time, its drafts kept per language</h2>
 *
 * The workspace below is keyed by the document, so nothing of one document's draft can appear
 * in another's fields. Typed text is held per language, so switching language to check a
 * translation loses nothing; switching document with unsaved text asks first. Publishing covers
 * what is saved, so it waits until nothing is unsaved.
 *
 * <h2>Dates in Baku</h2>
 *
 * A chosen effective date starts at 00:00 in Baku, which is what the hint says, and the earliest
 * is tomorrow: "today" is publishing now, and a date already begun would be refused as past.
 *
 * <h2>No motion</h2>
 *
 * Nothing here animates. This is a console screen whose one action cannot be taken back.
 */
export interface LegalDocumentEditorProps {
  readonly copy: LegalDocumentEditorCopy;
}

export function LegalDocumentEditor({ copy }: LegalDocumentEditorProps) {
  const [kind, setKind] = useState<DocumentKind>('TERMS_OF_USE');
  const [pending, setPending] = useState<DocumentKind | null>(null);
  const [unsaved, setUnsaved] = useState<readonly DocumentLocale[]>([]);

  function choose(next: DocumentKind): void {
    if (next === kind) return;
    if (unsaved.length > 0) {
      setPending(next);
      return;
    }
    setKind(next);
  }

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      <div className="flex flex-col gap-3">
        <Field label={copy.documentLabel} className="max-w-[360px]">
          <Select value={kind} onChange={(event) => choose(event.target.value as DocumentKind)}>
            {DOCUMENT_KINDS.map((option) => (
              <option key={option} value={option}>
                {copy.kind[option]}
              </option>
            ))}
          </Select>
        </Field>

        {pending !== null && (
          <Confirm
            label={copy.switchDocumentLabel}
            text={fillPlaceholders(copy.switchDocument, {
              languages: unsaved.map((entry) => copy.languageName[entry] ?? entry).join(', '),
            })}
            action={copy.switchDocumentAction}
            working={copy.switchDocumentAction}
            back={copy.back}
            busy={false}
            onConfirm={() => {
              setKind(pending);
              setPending(null);
              setUnsaved([]);
            }}
            onBack={() => setPending(null)}
          />
        )}
      </div>

      <DocumentWorkspace key={kind} kind={kind} copy={copy} onUnsavedChange={setUnsaved} />
    </div>
  );
}

/** Tomorrow in Baku, as the `YYYY-MM-DD` a date input takes. */
function tomorrowInBaku(now: Date): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** The public address of one version, for a link from the history. */
function publicPath(kind: DocumentKind, version: number): string | null {
  const slug = LEGAL_DOCUMENTS.find((candidate) => kindOf(candidate) === kind);
  return slug === undefined ? null : legalPath(slug, version);
}

type Typed = Readonly<Record<string, { readonly title: string; readonly body: string }>>;

type Asking = { readonly kind: 'publish' } | { readonly kind: 'activate'; readonly version: number };

function DocumentWorkspace({
  kind,
  copy,
  onUnsavedChange,
}: {
  readonly kind: DocumentKind;
  readonly copy: LegalDocumentEditorCopy;
  readonly onUnsavedChange: (languages: readonly DocumentLocale[]) => void;
}) {
  const readerLocale = useRouteLocale();
  const history = useConsoleResource(
    async (signal) => {
      try {
        return await readDocumentHistory(kind, signal);
      } catch (cause) {
        // Everything but the two refusals the hook renders itself, in the reader's words.
        if (cause instanceof ApiError && cause.status !== 401 && cause.status !== 403) {
          throw new ApiError(cause.status, { ...(cause.problem ?? {}), detail: copy.readFailed }, copy.readFailed);
        }
        throw cause;
      }
    },
    copy.subject,
    copy.refusals,
    [kind],
  );

  const [locale, setLocale] = useState<DocumentLocale>(GOVERNING);
  const [typed, setTyped] = useState<Typed>({});
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);

  const data: DocumentHistory | null = history.data;
  const drafts = data?.drafts ?? [];
  const savedOf = (language: string) => drafts.find((entry) => entry.locale === language) ?? null;

  const unsaved = DOCUMENT_LOCALES.filter((language) => {
    const edit = typed[language];
    if (edit === undefined) return false;
    const saved = savedOf(language);
    return edit.title !== (saved?.title ?? '') || edit.body !== (saved?.body ?? '');
  });
  const unsavedKey = unsaved.join(',');
  useEffect(() => onUnsavedChange(unsaved), [unsavedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (history.status === 'signed-out' || history.status === 'forbidden') {
    return <ConsoleRefusal status={history.status} capability={history.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (data === null) {
    if (history.status === 'failed') {
      return (
        <div>
          <InlineAlert variant="danger" title={copy.failedTitle}>
            {history.error ?? copy.readFailed}
          </InlineAlert>
          <Pill variant="ghost" size="sm" className="mt-4" onClick={history.reload}>
            {copy.tryAgain}
          </Pill>
        </div>
      );
    }
    return (
      <SkeletonGroup label={copy.loadingList}>
        <Skeleton height="1rem" width="40%" />
        <Skeleton height="0.875rem" width="60%" className="mt-3" />
      </SkeletonGroup>
    );
  }

  const documentName = copy.kind[kind] ?? kind;
  const languageOf = (language: string) => copy.languageName[language] ?? language;
  const saved = savedOf(locale);
  const title = typed[locale]?.title ?? saved?.title ?? '';
  const body = typed[locale]?.body ?? saved?.body ?? '';
  const edit = (next: { title?: string; body?: string }) =>
    setTyped((current) => ({ ...current, [locale]: { title: next.title ?? title, body: next.body ?? body } }));

  const drafted = drafts.map((entry) => entry.locale);
  const governingDrafted = drafted.includes(GOVERNING);
  const draftVersion = drafts[0]?.version ?? null;
  const now = new Date();
  const earliest = tomorrowInBaku(now);
  const versions = groupedByVersion(data.versions);
  const inForceVersion = data.inForceVersion ?? null;

  /** A refused write, worded by the screen. Never the service's English. */
  function refusalOf(cause: unknown): string {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      return actionMessageFor(cause, copy.subject, copy.refusals);
    }
    return codedRefusalFor(cause, copy.errors, copy.errors['INVALID_REQUEST'] ?? copy.refusals.refused, copy.subject, copy.refusals);
  }

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (cause) {
      setError(refusalOf(cause));
      // A publication somebody else already made, or a version that changed state, is news
      // about the document: read it again so the screen shows what is true now.
      if (refusalCode(cause) === 'NOTHING_TO_PUBLISH' || refusalCode(cause) === 'GOVERNING_TEXT_MISSING') history.reload();
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  const save = () =>
    act(async () => {
      const written = await writeDraft({ kind, locale, title: title.trim(), body: body.trim() });
      history.set({
        ...data,
        drafts: [...drafts.filter((entry) => entry.locale !== locale), written].sort((a, b) => a.locale.localeCompare(b.locale)),
      });
      setTyped((current) => {
        const next: Record<string, { readonly title: string; readonly body: string }> = { ...current };
        delete next[locale];
        return next;
      });
      setDone(fillPlaceholders(copy.savedNotice, { language: languageOf(locale), version: String(written.version) }));
    });

  const effectiveInstant = effectiveFrom === '' ? null : new Date(`${effectiveFrom}T00:00:00${BAKU_OFFSET}`).toISOString();
  const dateTooEarly = effectiveFrom !== '' && effectiveFrom < earliest;
  const when = effectiveFrom === '' ? copy.whenNow : fillPlaceholders(copy.whenDate, { date: calendarDate(effectiveFrom, readerLocale) });

  const publish = () =>
    act(async () => {
      const published = await publishDocument({ kind, effectiveFrom: effectiveInstant });
      const languages = published.documents.map((entry) => languageOf(entry.locale)).join(', ');
      const version = String(published.documents[0]?.version ?? '');
      setDone(
        effectiveFrom === ''
          ? fillPlaceholders(copy.publishedNotice, { version, languages })
          : fillPlaceholders(copy.publishedFuture, { version, languages, date: calendarDate(effectiveFrom, readerLocale) }),
      );
      setEffectiveFrom('');
      setTyped({});
      history.reload();
    });

  const activate = (version: number) =>
    act(async () => {
      await activateVersion(kind, version);
      setDone(fillPlaceholders(copy.activatedNotice, { version: String(version) }));
      history.reload();
    });

  const reaccept = copy.reaccept[kind];

  return (
    <div className="flex flex-col gap-10">
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

        <div className="mt-4 flex flex-col gap-3">
          <Field label={copy.languageLabel} hint={copy.languageHint} className="max-w-[360px]">
            <Select value={locale} onChange={(event) => setLocale(event.target.value as DocumentLocale)}>
              {DOCUMENT_LOCALES.map((option) => (
                <option key={option} value={option}>
                  {unsaved.includes(option)
                    ? fillPlaceholders(copy.unsavedOption, { language: copy.locale[option] ?? option })
                    : copy.locale[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={copy.titleLabel}>
            <TextInput value={title} maxLength={200} onChange={(event) => edit({ title: event.target.value })} />
          </Field>

          <Field label={copy.bodyLabel} hint={copy.bodyHint}>
            <Textarea rows={16} value={body} onChange={(event) => edit({ body: event.target.value })} />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            {/*
              Saving is `ghost` and publishing is `primary`, and neither is `accent`. Lime is for
              urgency, and this is not urgent — it is irreversible, which is a different thing.
            */}
            <Pill variant="ghost" onClick={() => void save()} disabled={busy || title.trim() === '' || body.trim() === ''}>
              {busy ? copy.working : copy.save}
            </Pill>
          </div>
        </div>
      </section>

      <section aria-labelledby="legal-publish-heading">
        <h2 id="legal-publish-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.publishHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.publishIntro}</p>

        {drafted.length === 0 ? (
          <EmptyState className="mt-4" variant="empty" title={copy.nothingDraftedTitle} description={copy.nothingDraftedBody} />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-white/64">
              {fillPlaceholders(copy.willPublish, { languages: drafted.map(languageOf).join(', ') })}
            </p>

            {/* Stated before the request rather than after it: an operator who has spent an
                afternoon on the English text should not learn at the last control that it was
                never publishable. */}
            {!governingDrafted && (
              <InlineAlert variant="warning" title={copy.governingMissingTitle}>
                {copy.governingMissingBody}
              </InlineAlert>
            )}

            {unsaved.length > 0 && (
              <InlineAlert variant="warning" title={copy.unsavedTitle}>
                {fillPlaceholders(copy.unsavedBody, { languages: unsaved.map(languageOf).join(', ') })}
              </InlineAlert>
            )}

            <Field label={copy.effectiveFromLabel} hint={copy.effectiveFromHint} className="max-w-[280px]">
              <TextInput type="date" min={earliest} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </Field>
            {dateTooEarly && <p className="text-sm text-white">{copy.errors['EFFECTIVE_DATE_IN_THE_PAST']}</p>}

            {asking?.kind === 'publish' ? (
              <Confirm
                label={copy.confirmPublishLabel}
                text={[
                  fillPlaceholders(copy.confirmPublish, {
                    document: documentName,
                    version: String(draftVersion ?? ''),
                    languages: drafted.map(languageOf).join(', '),
                    when,
                  }),
                  reaccept,
                ]
                  .filter((part) => part !== undefined && part !== '')
                  .join(' ')}
                action={copy.confirmPublishAction}
                working={copy.working}
                back={copy.back}
                busy={busy}
                onConfirm={() => void publish()}
                onBack={() => setAsking(null)}
              />
            ) : (
              <div>
                <Pill
                  variant="primary"
                  onClick={() => setAsking({ kind: 'publish' })}
                  disabled={busy || !governingDrafted || unsaved.length > 0 || dateTooEarly}
                >
                  {copy.publish}
                </Pill>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="legal-history-heading">
        <h2 id="legal-history-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.historyHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.historyIntro}</p>

        {versions.length === 0 ? (
          <EmptyState className="mt-4" variant="empty" title={copy.noVersionsTitle} description={copy.noVersionsBody} />
        ) : (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {versions.map(({ version, rows, governing }) => {
              const effective = governing.effectiveFrom ?? null;
              const future = effective !== null && new Date(effective).getTime() > now.getTime();
              const shown = version === inForceVersion;
              const path = publicPath(kind, version);
              return (
                <li key={version} className="flex flex-col gap-2 rounded-lg border border-white/12 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {fillPlaceholders(copy.versionLabel, { version: String(version) })}
                    </span>
                    {rows.map((row) => (
                      <Tag key={row.locale}>{languageOf(row.locale)}</Tag>
                    ))}
                    {shown && <Tag variant="success">{copy.shownOnSite}</Tag>}
                    {future && effective !== null && (
                      <Tag variant="warning">{fillPlaceholders(copy.takesEffect, { date: bakuDate(effective, readerLocale) })}</Tag>
                    )}
                  </div>
                  <p className="text-sm text-white/80">{governing.title}</p>
                  <p className="break-all text-[13px] text-white/64">
                    {fillPlaceholders(copy.versionMeta, {
                      from: effective === null ? '' : bakuDate(effective, readerLocale),
                      /*
                        Twelve characters of the digest: enough to compare two by eye, short enough
                        to read out. The whole hash is on the public route for anybody checking.
                      */
                      hash: governing.contentHash.slice(0, 12),
                    })}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {path !== null && (
                      <Link
                        href={path}
                        className="rounded text-sm text-white underline decoration-white/24 underline-offset-2 hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                      >
                        {copy.openOnSite}
                      </Link>
                    )}
                    {!shown && !future && asking?.kind !== 'activate' && (
                      <Pill variant="ghost" size="sm" onClick={() => setAsking({ kind: 'activate', version })} disabled={busy}>
                        {copy.showOnSite}
                      </Pill>
                    )}
                  </div>
                  {asking?.kind === 'activate' && asking.version === version && (
                    <Confirm
                      label={copy.confirmActivateLabel}
                      text={[fillPlaceholders(copy.confirmActivate, { document: documentName, version: String(version) }), reaccept]
                        .filter((part) => part !== undefined && part !== '')
                        .join(' ')}
                      action={copy.showOnSite}
                      working={copy.working}
                      back={copy.back}
                      busy={busy}
                      onConfirm={() => void activate(version)}
                      onBack={() => setAsking(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One row per version, its languages together, with the governing row first. Newest first. */
function groupedByVersion(
  rows: readonly DocumentSummary[],
): { version: number; rows: DocumentSummary[]; governing: DocumentSummary }[] {
  const byVersion = new Map<number, DocumentSummary[]>();
  for (const row of rows) {
    const list = byVersion.get(row.version) ?? [];
    list.push(row);
    byVersion.set(row.version, list);
  }
  return [...byVersion.entries()]
    .sort(([left], [right]) => right - left)
    .flatMap(([version, list]) => {
      const ordered = [...list].sort(
        (a, b) => DOCUMENT_LOCALES.indexOf(a.locale as DocumentLocale) - DOCUMENT_LOCALES.indexOf(b.locale as DocumentLocale),
      );
      const governing = ordered.find((row) => row.locale === GOVERNING) ?? ordered[0];
      return governing === undefined ? [] : [{ version, rows: ordered, governing }];
    });
}
