'use client';

import { useState } from 'react';
import {
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  TextInput,
} from '@ideanest/ui';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import {
  createCategory,
  createSubcategory,
  editTaxonomyEntry,
  readTaxonomy,
  readTaxonomyTags,
  translateTaxonomyEntry,
  type TaxonomyBranch,
  type TaxonomyEntry,
} from '../../lib/admin/taxonomy';
import { LOCALE_NAMES, type Locale } from '../../lib/i18n/locale';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { TaxonomyManagerCopy } from '../../lib/i18n/admin/curation-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * §4.11's AD-08: categories, subcategories and tags with a translation per locale — issue #309.
 *
 * <h2>What was blocking this, and what it turned out to be</h2>
 *
 * #309 said "§4.3 requires the taxonomy be editable without a deployment, and no API exposes
 * it". The tables had existed since V6 and V11; what did not exist was any way to write to
 * them — the entities said so in as many words, "nothing in the application creates a category;
 * the migration does". So this is the screen half of a feature whose schema was already there.
 *
 * <h2>Handles cannot be changed and the screen does not offer to</h2>
 *
 * A slug is in the public URL of every campaign filed under a category, and the platform has no
 * redirect table — renaming one breaks every link anybody has shared, silently, with no way to
 * count them. The edit form has no slug field at all, which is cheaper than a warning somebody
 * clicks through.
 *
 * <h2>Nothing here deletes, and it says why</h2>
 *
 * `projects.category_id` references these rows. A delete either fails on the constraint or
 * takes campaigns with it, and retiring a category — hiding it from the editor while leaving
 * the campaigns filed under it — needs a column V6 does not have. Saying that is better than a
 * button that returns a 409.
 */
export interface TaxonomyManagerProps {
  readonly copy: TaxonomyManagerCopy;
}

export function TaxonomyManager({ copy }: TaxonomyManagerProps) {
  const locale = useRouteLocale();
  const tree = useConsoleResource(
    (signal) => readTaxonomy(signal),
    copy.subject,
    copy.refusals,
    [],
  );
  const tags = useConsoleResource(
    (signal) => readTaxonomyTags(signal),
    copy.tagsSubject,
    copy.refusals,
    [],
  );

  const [busy, setBusy] = useState(false);

  if (tree.status === 'signed-out' || tree.status === 'forbidden') {
    return <ConsoleRefusal status={tree.status} capability={tree.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  async function act(work: () => Promise<unknown>): Promise<string | null> {
    setBusy(true);
    try {
      await work();
      tree.reload();
      return null;
    } catch (cause) {
      return consoleMessageFor(cause, copy.subject, copy.refusals);
    } finally {
      setBusy(false);
    }
  }

  const branches = tree.data?.branches ?? [];
  const allTags = tags.data?.tags ?? [];

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.warningTitle}>
        {copy.warningBody}
      </InlineAlert>

      <section aria-labelledby="tree-heading">
        <h2 id="tree-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.categories}
          {tree.data !== null && (
            <span className="ml-2 text-xs font-normal text-white/40">{branches.length}</span>
          )}
        </h2>

        {tree.status === 'loading' && tree.data === null && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                  <Skeleton height="1rem" width="35%" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}

        {tree.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {tree.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={tree.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {tree.data !== null && tree.status !== 'failed' && branches.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.emptyTitle}
            description={copy.emptyBody}
          />
        )}

        {tree.data !== null && tree.status !== 'failed' && branches.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {branches.map((branch) => (
              <Branch
                key={branch.category.id}
                branch={branch}
                busy={busy}
                copy={copy}
                locale={locale}
                onAct={act}
              />
            ))}
          </ul>
        )}
      </section>

      <NewEntry
        heading={copy.addCategoryHeading}
        hint={copy.handleHint}
        copy={copy}
        busy={busy}
        onCreate={(entry) =>
          act(() => createCategory({ ...entry, sortOrder: nextOrder(branches.map((b) => b.category)) }))
        }
      />

      <section aria-labelledby="tags-heading">
        <h2 id="tags-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.tagsHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.tagsIntro}</p>

        {tags.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <Skeleton height="1.75rem" width="60%" />
          </SkeletonGroup>
        )}
        {tags.status === 'failed' && (
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {tags.error}
          </InlineAlert>
        )}
        {tags.status === 'ready' && allTags.length > 0 && (
          <>
            <ul className="mt-4 flex list-none flex-wrap gap-2">
              {allTags.slice(0, TAG_LIMIT).map((tag) => (
                <li key={tag.id} className="rounded-md border border-white/8 px-2.5 py-1.5 text-xs text-white/64">
                  {tag.label} <span className="text-white/40">{tag.usageCount}</span>
                </li>
              ))}
            </ul>
            {allTags.length > TAG_LIMIT && (
              <p className="mt-2 text-xs text-white/40">
                {fillPlaceholders(copy.tagsShown, {
                  shown: String(TAG_LIMIT),
                  total: String(allTags.length),
                })}
              </p>
            )}
          </>
        )}
        {tags.status === 'ready' && allTags.length === 0 && (
          <p className="mt-4 text-sm text-white/48">{copy.noTags}</p>
        )}
      </section>
    </div>
  );
}

const TAG_LIMIT = 60;

/** The other two of §21.1's languages, which live in the translations table rather than on the row. */
const TRANSLATED_LOCALES = ['ru', 'tr'] as const satisfies readonly Locale[];

type Act = (work: () => Promise<unknown>) => Promise<string | null>;

function nextOrder(entries: readonly TaxonomyEntry[]): number {
  return entries.reduce((highest, entry) => Math.max(highest, entry.sortOrder), 0) + 10;
}

/** The entry's name in the reader's language, by the chain the public site uses. */
function nameIn(entry: TaxonomyEntry, locale: Locale): string {
  if (locale === 'az') return entry.nameAz;
  if (locale === 'en') return entry.nameEn;
  const translated = entry.translations[locale];
  return translated != null && translated !== '' ? translated : entry.nameEn;
}

/** One category, its subcategories, and the names of each. */
function Branch({
  branch,
  busy,
  copy,
  locale,
  onAct,
}: {
  readonly branch: TaxonomyBranch;
  readonly busy: boolean;
  readonly copy: TaxonomyManagerCopy;
  readonly locale: Locale;
  readonly onAct: Act;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `category-${branch.category.id}`;

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] text-white">
            {nameIn(branch.category, locale)}
            <span className="ml-2 font-mono text-xs text-white/40">{branch.category.slug}</span>
          </p>
          <p className="mt-1 text-xs text-white/48">
            {branch.subcategories.length > 0
              ? pluralise(locale, copy.subcategories, branch.subcategories.length)
              : copy.noSubcategories}
          </p>
        </div>
        <Pill
          variant="ghost"
          size="sm"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
        >
          {open ? copy.done : copy.edit}
        </Pill>
      </div>

      {open && (
        <div id={panelId} className="mt-4 border-t border-white/8 pt-4">
          <EntryEditor entry={branch.category} kind="categories" busy={busy} copy={copy} onAct={onAct} />

          {branch.subcategories.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-medium text-white">{copy.subcategoriesHeading}</h3>
              <ul className="mt-3 flex list-none flex-col gap-2 border-l border-white/8 pl-4">
                {branch.subcategories.map((subcategory) => (
                  <li key={subcategory.id}>
                    <EntryEditor
                      entry={subcategory}
                      kind="subcategories"
                      busy={busy}
                      copy={copy}
                      onAct={onAct}
                      heading={nameIn(subcategory, locale)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-6 border-t border-white/8 pt-4">
            <NewEntry
              heading={copy.newSubcategoryLabel}
              hint={copy.newSubcategoryHint}
              copy={copy}
              busy={busy}
              compact
              onCreate={(entry) =>
                onAct(() =>
                  createSubcategory(branch.category.id, {
                    ...entry,
                    sortOrder: nextOrder(branch.subcategories),
                  }),
                )
              }
            />
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Every name an entry has, in one form.
 *
 * <p>Azerbaijani and English live on the row and travel together, so they are one `PATCH`;
 * Russian and Turkish are translations, one `PUT` each, sent only when they changed. There is
 * no endpoint that removes a translation, so emptying one is not offered as a change.
 */
function EntryEditor({
  entry,
  kind,
  busy,
  copy,
  onAct,
  heading,
}: {
  readonly entry: TaxonomyEntry;
  readonly kind: 'categories' | 'subcategories';
  readonly busy: boolean;
  readonly copy: TaxonomyManagerCopy;
  readonly onAct: Act;
  readonly heading?: string;
}) {
  const [nameAz, setNameAz] = useState(entry.nameAz);
  const [nameEn, setNameEn] = useState(entry.nameEn);
  const [translations, setTranslations] = useState<Record<string, string>>(() =>
    Object.fromEntries(TRANSLATED_LOCALES.map((code) => [code, entry.translations[code] ?? ''])),
  );
  const [outcome, setOutcome] = useState<{ readonly ok: boolean; readonly message: string } | null>(
    null,
  );

  const renamed = nameAz.trim() !== entry.nameAz || nameEn.trim() !== entry.nameEn;
  const retranslated = TRANSLATED_LOCALES.filter((code) => {
    const value = (translations[code] ?? '').trim();
    return value !== '' && value !== (entry.translations[code] ?? '');
  });
  const blank = nameAz.trim() === '' || nameEn.trim() === '';

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (blank || (!renamed && retranslated.length === 0)) return;

    setOutcome(null);
    const failure = await onAct(async () => {
      if (renamed) {
        await editTaxonomyEntry(kind, entry.id, {
          nameAz: nameAz.trim(),
          nameEn: nameEn.trim(),
          sortOrder: entry.sortOrder,
        });
      }
      for (const code of retranslated) {
        await translateTaxonomyEntry(kind, entry.id, code, (translations[code] ?? '').trim());
      }
    });
    setOutcome(failure === null ? { ok: true, message: copy.savedNotice } : { ok: false, message: failure });
  }

  return (
    <form onSubmit={(event) => void save(event)} className="rounded-md border border-white/8 p-3">
      <p className="text-sm text-white">
        {heading !== undefined && <span className="mr-2">{heading}</span>}
        <span className="font-mono text-xs text-white/40">{entry.slug}</span>
      </p>

      <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
        <Field label={LOCALE_NAMES.az} required>
          <TextInput lang="az" value={nameAz} onChange={(event) => setNameAz(event.target.value)} />
        </Field>
        <Field label={LOCALE_NAMES.en} required>
          <TextInput lang="en" value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        {TRANSLATED_LOCALES.map((code) => (
          <Field key={code} label={LOCALE_NAMES[code]} hint={copy.translationHint}>
            <TextInput
              lang={code}
              value={translations[code] ?? ''}
              placeholder={entry.nameEn}
              onChange={(event) => setTranslations({ ...translations, [code]: event.target.value })}
            />
          </Field>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Pill
          type="submit"
          variant="outline"
          size="sm"
          disabled={busy || blank || (!renamed && retranslated.length === 0)}
        >
          {copy.save}
        </Pill>
        <span role="status" aria-live="polite" className="text-sm empty:hidden">
          {outcome !== null && (
            <span className={outcome.ok ? 'text-success' : 'text-danger'}>{outcome.message}</span>
          )}
        </span>
      </div>
    </form>
  );
}

/** A category, or a subcategory under the one it is drawn in. The handle is permanent. */
function NewEntry({
  heading,
  hint,
  copy,
  busy,
  compact = false,
  onCreate,
}: {
  readonly heading: string;
  readonly hint: string;
  readonly copy: TaxonomyManagerCopy;
  readonly busy: boolean;
  readonly compact?: boolean;
  readonly onCreate: (entry: { slug: string; nameAz: string; nameEn: string }) => Promise<string | null>;
}) {
  const [slug, setSlug] = useState('');
  const [nameAz, setNameAz] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const incomplete = slug.trim() === '' || nameAz.trim() === '' || nameEn.trim() === '';

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (incomplete) return;

    const handle = slug.trim();
    if (!TAXONOMY_HANDLE.test(handle)) {
      setHandleError(copy.handleInvalid);
      return;
    }

    setHandleError(null);
    setFailure(null);
    const refused = await onCreate({ slug: handle, nameAz: nameAz.trim(), nameEn: nameEn.trim() });
    if (refused !== null) {
      setFailure(refused);
      return;
    }
    setSlug('');
    setNameAz('');
    setNameEn('');
  }

  const Heading = compact ? 'h3' : 'h2';

  return (
    <section>
      <Heading
        className={
          compact
            ? 'text-sm font-medium text-white'
            : 'text-lg font-medium tracking-[-0.02em] text-white'
        }
      >
        {heading}
      </Heading>

      <form onSubmit={(event) => void submit(event)} className="mt-3">
        <div className="grid items-start gap-3 sm:grid-cols-3">
          <Field label={copy.handleLabel} required hint={hint} error={handleError}>
            <TextInput
              value={slug}
              autoCapitalize="none"
              spellCheck={false}
              placeholder={compact ? 'board-games' : 'games'}
              onChange={(event) => {
                setSlug(event.target.value);
                setHandleError(null);
              }}
            />
          </Field>
          <Field label={LOCALE_NAMES.az} required>
            <TextInput lang="az" value={nameAz} onChange={(event) => setNameAz(event.target.value)} />
          </Field>
          <Field label={LOCALE_NAMES.en} required>
            <TextInput lang="en" value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
          </Field>
        </div>

        {failure !== null && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-3">
            {failure}
          </InlineAlert>
        )}

        <Pill type="submit" variant="outline" size="sm" className="mt-3" disabled={busy || incomplete}>
          {copy.add}
        </Pill>
      </form>
    </section>
  );
}

/** `TaxonomyAdminController.CreateCategoryRequest`'s pattern, so a bad handle is caught before the request. */
const TAXONOMY_HANDLE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
