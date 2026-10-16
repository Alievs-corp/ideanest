'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from '../../i18n/navigation';
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
import { ApiError } from '../../lib/api/problem';
import {
  COLLECTION_KINDS,
  addProject,
  bodyOf,
  collectionTitle,
  copyIn,
  isPublished,
  publishCollection,
  readCollection,
  removeProject,
  reorderProjects,
  replaceCollection,
  searchCampaigns,
  unpublishCollection,
  type AdminCollection,
  type CampaignMatch,
  type CollectionCopy,
  type CollectionKind,
  type CollectionMember,
} from '../../lib/admin/curation';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { CollectionEditorCopy } from '../../lib/i18n/admin/curation-copy';
import type { NoteDialogCopy } from '../../lib/i18n/admin/common-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { NoteDialog } from './NoteDialog';

export interface CollectionEditorProps {
  readonly slug: string;
  readonly copy: CollectionEditorCopy;
  readonly note: NoteDialogCopy;
}

/**
 * §4.11's AD-03: one collection and the campaigns in it — issues #301 and #303.
 *
 * <h2>Membership is the only thing edited here that a reader ever sees directly</h2>
 *
 * A collection's copy, kind and window are what it is; its membership is what it contains, and
 * on a badge-granting collection <strong>adding a campaign is applying §3.2's editorial
 * badge</strong>. That is why the add and the remove go through a required note and a dialog,
 * where the placement editor's move does not: one is a decision about which campaigns the
 * platform stands behind, the other is which order six lists appear in.
 *
 * <h2>Campaigns the public cannot see are shown, and marked</h2>
 *
 * The admin projection returns membership rows whose campaign has since been suspended or
 * unpublished. Hiding those would leave a curator unable to remove the one thing they came to
 * remove — and a collection whose visible count is lower than its membership is exactly the
 * situation somebody is investigating when they open this page.
 *
 * <h2>Reordering restates the whole sequence</h2>
 *
 * `PUT …/projects/order` takes every campaign in the collection exactly once, because a
 * partial order would leave the rest wherever they happened to be. So a move sends the full
 * list with two entries swapped, which is also what makes a move one request here and two on
 * the placement editor.
 *
 * <h2>Nothing is optimistic</h2>
 *
 * Every response is the collection as the service now holds it, and it replaces local state
 * wholesale. The same rule the moderation queue and the account directory follow: these are
 * audited changes another curator may be making at the same moment.
 */
export function CollectionEditor({ slug, copy, note }: CollectionEditorProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [collection, setCollection] = useState<AdminCollection | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      setNotFound(false);
      try {
        const loaded = await readCollection(slug, controller.signal);
        if (controller.signal.aborted) return;

        setCollection(loaded);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true);
          setStatus('ready');
          return;
        }
        const next = statusFor(cause);
        setCapability(requiredCapabilityFrom(cause));
        if (next === 'failed') setError(consoleMessageFor(cause, copy.subject, copy.refusals));
        setStatus(next);
      }
    }

    void load();
    return () => controller.abort();
    // The copy is one object per server render — see `useConsoleResource` for the argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, attempt]);

  const move = useCallback(
    async (index: number, direction: -1 | 1): Promise<void> => {
      const members = collection?.projects;
      if (collection === undefined || collection === null || members === undefined || reordering) {
        return;
      }

      const ids = members.map((member) => member.projectId);
      const from = ids[index];
      const to = ids[index + direction];
      if (from === undefined || to === undefined) return;

      const next = [...ids];
      next[index] = to;
      next[index + direction] = from;

      setReordering(true);
      setError(null);
      try {
        setCollection(await reorderProjects(collection.slug, next));
      } catch (cause) {
        setError(consoleMessageFor(cause, copy.subject, copy.refusals));
      } finally {
        setReordering(false);
      }
    },
    [collection, reordering, copy],
  );

  const back = (
    <Link
      href="/admin/curation"
      className="inline-flex items-center gap-1.5 rounded-lg text-sm text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {copy.backToCollections}
    </Link>
  );

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingList}>
        <div className="rounded-xl border border-white/8 bg-surface-1 p-5">
          <Skeleton height="1.25rem" width="40%" />
          <Skeleton height="0.875rem" width="60%" className="mt-3" />
        </div>
      </SkeletonGroup>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        variant="empty"
        title={copy.notFoundTitle}
        description={copy.notFoundBody}
        action={back}
      />
    );
  }

  if (collection === null) {
    return (
      <>
        {error !== null && (
          <InlineAlert variant="danger" title={copy.errorTitle}>
            {error}
          </InlineAlert>
        )}
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  const members = collection.projects ?? [];
  const hidden = members.filter((member) => !member.publiclyVisible).length;
  const published = isPublished(collection);

  async function commit(text: string): Promise<void> {
    if (pending === null || collection === null) return;

    setDialogBusy(true);
    setDialogError(null);
    setError(null);
    try {
      if (pending.kind === 'add') {
        setCollection(await addProject(collection.slug, pending.campaign.projectId, text));
        setNotice(fillPlaceholders(copy.addedNotice, { title: pending.campaign.title }));
      } else if (pending.kind === 'remove') {
        setCollection(await removeProject(collection.slug, pending.member.projectId, text));
        setNotice(fillPlaceholders(copy.removedNotice, { title: pending.member.title }));
      } else {
        const updated =
          pending.kind === 'publish'
            ? await publishCollection(collection.slug, text)
            : await unpublishCollection(collection.slug, text);
        setCollection(updated);
        setNotice(
          fillPlaceholders(
            pending.kind === 'publish' ? copy.publishedNotice : copy.unpublishedNotice,
            { title: collectionTitle(updated) },
          ),
        );
      }
      setPending(null);
    } catch (cause) {
      setDialogError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setDialogBusy(false);
    }
  }

  const pendingTitle =
    pending === null
      ? null
      : pending.kind === 'add'
        ? fillPlaceholders(copy.addTitle, { title: pending.campaign.title })
        : pending.kind === 'remove'
          ? fillPlaceholders(copy.removeTitle, { title: pending.member.title })
          : fillPlaceholders(pending.kind === 'publish' ? copy.publishTitle : copy.unpublishTitle, {
              title: collectionTitle(collection),
            });

  const pendingBody =
    pending === null || !collection.grantsBadge
      ? undefined
      : pending.kind === 'add'
        ? copy.addBadgeBody
        : pending.kind === 'remove'
          ? copy.removeBadgeBody
          : pending.kind === 'publish'
            ? copy.publishBadgeBody
            : undefined;

  return (
    <div>
      {back}

      <section
        aria-labelledby="collection-heading"
        className="mt-4 rounded-xl border border-white/8 bg-surface-1 p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="collection-heading"
              className="text-lg font-medium tracking-[-0.02em] text-white"
            >
              {collectionTitle(collection)}
            </h2>
            <p className="mt-1 font-mono text-xs text-white/40">
              /collections/{collection.slug}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{copy.curation.kind[collection.kind]}</Tag>
            {collection.grantsBadge && <Tag variant="warning">{copy.curation.grantsBadge}</Tag>}
            <Tag variant={published ? 'success' : 'default'}>
              {published ? copy.curation.published : copy.curation.unpublished}
            </Tag>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Pill
            variant="outline"
            size="sm"
            onClick={() => {
              setDialogError(null);
              setPending({ kind: published ? 'unpublish' : 'publish' });
            }}
          >
            {published ? copy.takeDown : copy.publish}
          </Pill>
          {!published && members.length === 0 && (
            <p className="text-sm text-white/48">{copy.emptyBeforePublish}</p>
          )}
        </div>
      </section>

      <div role="status" aria-live="polite" className="empty:hidden">
        {notice !== null && (
          <InlineAlert variant="success" className="mt-4">
            {notice}
          </InlineAlert>
        )}
      </div>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      <section aria-labelledby="members-heading" className="mt-8">
        <h2 id="members-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.campaigns}
          <span className="ml-2 text-xs font-normal text-white/40">{members.length}</span>
        </h2>
        {hidden > 0 && (
          <p className="mt-1 max-w-[62ch] text-sm text-white/48">
            {pluralise(locale, copy.hidden, hidden)}
          </p>
        )}

        <CampaignPicker
          members={members}
          copy={copy}
          onPick={(campaign) => {
            setDialogError(null);
            setPending({ kind: 'add', campaign });
          }}
        />

        {members.length === 0 ? (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.emptyTitle}
            description={copy.emptyBody}
          />
        ) : (
          <ol className="mt-4 flex list-none flex-col gap-2">
            {members.map((member, index) => (
              <li
                key={member.projectId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-surface-1 p-4"
              >
                <div className="min-w-0">
                  <p className="text-[15px] text-white">{member.title}</p>
                  <p className="mt-1 font-mono text-xs text-white/40">{member.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!member.publiclyVisible && (
                    <Tag variant="warning">{stateLabel(copy, member.state)}</Tag>
                  )}
                  <Pill
                    variant="outline"
                    size="sm"
                    disabled={reordering || index === 0}
                    aria-label={fillPlaceholders(copy.curation.moveUpLabel, {
                      title: member.title,
                    })}
                    onClick={() => void move(index, -1)}
                  >
                    {copy.curation.moveUp}
                  </Pill>
                  <Pill
                    variant="outline"
                    size="sm"
                    disabled={reordering || index === members.length - 1}
                    aria-label={fillPlaceholders(copy.curation.moveDownLabel, {
                      title: member.title,
                    })}
                    onClick={() => void move(index, 1)}
                  >
                    {copy.curation.moveDown}
                  </Pill>
                  <Pill
                    variant="ghost"
                    size="sm"
                    aria-label={fillPlaceholders(copy.removeLabel, { title: member.title })}
                    onClick={() => {
                      setDialogError(null);
                      setPending({ kind: 'remove', member });
                    }}
                  >
                    {copy.remove}
                  </Pill>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <CollectionDetails
        key={`${collection.slug}:${collection.kind}:${JSON.stringify(collection.copy)}`}
        collection={collection}
        copy={copy}
        onSaved={(updated) => {
          setCollection(updated);
          setNotice(fillPlaceholders(copy.savedNotice, { title: collectionTitle(updated) }));
        }}
      />

      <NoteDialog
        title={pendingTitle}
        description={
          pending?.kind === 'add'
            ? copy.addDescription
            : pending?.kind === 'remove'
              ? copy.removeDescription
              : pending?.kind === 'publish'
                ? copy.publishDescription
                : copy.unpublishDescription
        }
        body={pendingBody}
        confirmLabel={
          pending?.kind === 'add'
            ? copy.add
            : pending?.kind === 'remove'
              ? copy.remove
              : pending?.kind === 'publish'
                ? copy.publish
                : copy.takeDown
        }
        busyLabel={
          pending?.kind === 'add'
            ? copy.adding
            : pending?.kind === 'remove'
              ? copy.removing
              : pending?.kind === 'publish'
                ? copy.publishing
                : copy.takingDown
        }
        destructive={pending?.kind === 'remove' || pending?.kind === 'unpublish'}
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => {
          setPending(null);
          setDialogError(null);
        }}
        onConfirm={(text) => void commit(text)}
        copy={note}
      />
    </div>
  );
}

type Pending =
  | { readonly kind: 'add'; readonly campaign: CampaignMatch }
  | { readonly kind: 'remove'; readonly member: CollectionMember }
  | { readonly kind: 'publish' }
  | { readonly kind: 'unpublish' };

function stateLabel(copy: CollectionEditorCopy, state: string): string {
  return (copy.campaignState as Readonly<Record<string, string | undefined>>)[state] ?? state;
}

/**
 * The collection's words in each of §21.1's languages, and its kind.
 *
 * <p>Creating a collection asks only for the Azerbaijani title, so until this form existed a
 * typo in it was permanent and no other language could ever be given one. Every field is sent
 * back through `bodyOf`, because `PUT` replaces the whole description.
 */
function CollectionDetails({
  collection,
  copy,
  onSaved,
}: {
  readonly collection: AdminCollection;
  readonly copy: CollectionEditorCopy;
  readonly onSaved: (updated: AdminCollection) => void;
}) {
  const initial = Object.fromEntries(
    SUPPORTED_LOCALES.map((code) => [code, copyIn(collection, code)]),
  ) as Record<Locale, { title: string; description: string }>;

  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState<CollectionKind>(collection.kind);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState<readonly Locale[]>([]);

  const changed =
    kind !== collection.kind ||
    SUPPORTED_LOCALES.some(
      (code) =>
        draft[code].title.trim() !== initial[code].title ||
        draft[code].description.trim() !== initial[code].description,
    );

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const untitled = SUPPORTED_LOCALES.filter(
      (code) =>
        draft[code].title.trim() === '' &&
        (code === 'az' || draft[code].description.trim() !== ''),
    );
    setMissing(untitled);
    if (untitled.length > 0) return;

    const next: Record<string, CollectionCopy> = {};
    for (const code of SUPPORTED_LOCALES) {
      const title = draft[code].title.trim();
      if (title === '') continue;
      const description = draft[code].description.trim();
      next[code] = description === '' ? { title } : { title, description };
    }

    setBusy(true);
    setFailure(null);
    try {
      onSaved(await replaceCollection(collection.slug, { ...bodyOf(collection), kind, copy: next }));
    } catch (cause) {
      setFailure(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="details-heading" className="mt-10">
      <h2 id="details-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.detailsHeading}
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm text-white/48">{copy.detailsIntro}</p>

      <form
        noValidate
        onSubmit={(event) => void save(event)}
        className="mt-4 rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5"
      >
        <Field label={copy.kindLabel} className="max-w-[280px]">
          <Select value={kind} onChange={(event) => setKind(event.target.value as CollectionKind)}>
            {COLLECTION_KINDS.map((option) => (
              <option key={option} value={option}>
                {copy.curation.kind[option]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="mt-5 flex flex-col gap-5">
          {SUPPORTED_LOCALES.map((code) => (
            <fieldset key={code} className="border-t border-white/8 pt-4">
              <legend className="sr-only">{LOCALE_NAMES[code]}</legend>
              <p aria-hidden="true" className="text-xs font-medium tracking-[0.04em] text-white/48 uppercase">
                {LOCALE_NAMES[code]}
              </p>
              <div className="mt-3 grid items-start gap-3 sm:grid-cols-[2fr_3fr]">
                <Field
                  label={copy.titleLabel}
                  required={code === 'az'}
                  error={missing.includes(code) ? copy.titleMissing : undefined}
                >
                  <TextInput
                    lang={code}
                    value={draft[code].title}
                    onChange={(event) =>
                      setDraft({ ...draft, [code]: { ...draft[code], title: event.target.value } })
                    }
                  />
                </Field>
                <Field label={copy.descriptionLabel}>
                  <Textarea
                    lang={code}
                    rows={2}
                    autoGrow
                    value={draft[code].description}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        [code]: { ...draft[code], description: event.target.value },
                      })
                    }
                  />
                </Field>
              </div>
            </fieldset>
          ))}
        </div>

        {failure !== null && (
          <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
            {failure}
          </InlineAlert>
        )}

        <Pill type="submit" variant="outline" size="sm" disabled={busy || !changed} className="mt-5">
          {busy ? copy.curation.saving : copy.save}
        </Pill>
      </form>
    </section>
  );
}

const PICKER_LIMIT = 8;

/**
 * Finding a campaign by what a curator knows about it — its title, its path or its creator.
 *
 * <p>This used to be a field asking for the campaign's UUID, which nobody has to hand. It
 * searches the campaign directory, and an identifier pasted into it still finds the one
 * campaign it names.
 */
function CampaignPicker({
  members,
  copy,
  onPick,
}: {
  readonly members: readonly CollectionMember[];
  readonly copy: CollectionEditorCopy;
  readonly onPick: (campaign: CampaignMatch) => void;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<readonly CampaignMatch[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function search(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const term = query.trim();
    if (term === '') return;

    setSearching(true);
    setFailure(null);
    try {
      setResults(await searchCampaigns(term, PICKER_LIMIT));
    } catch (cause) {
      setResults(null);
      setFailure(consoleMessageFor(cause, copy.searchSubject, copy.refusals));
    } finally {
      setSearching(false);
    }
  }

  const inCollection = new Set(members.map((member) => member.projectId));

  return (
    <div className="mt-4 rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5">
      <form onSubmit={(event) => void search(event)} role="search">
        <Field label={copy.addLabel} hint={copy.addHint}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <TextInput
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Pill
              type="submit"
              variant="outline"
              disabled={searching || query.trim() === ''}
              className="shrink-0"
            >
              {searching ? copy.searching : copy.search}
            </Pill>
          </div>
        </Field>
      </form>

      {failure !== null && (
        <InlineAlert variant="danger" title={copy.searchFailedTitle} className="mt-4">
          {failure}
        </InlineAlert>
      )}

      {results !== null && results.length === 0 && (
        <p className="mt-4 text-sm text-white/48">{copy.noResults}</p>
      )}

      {results !== null && results.length > 0 && (
        <ul aria-label={copy.resultsLabel} className="mt-4 flex list-none flex-col gap-2">
          {results.map((campaign) => {
            const already = inCollection.has(campaign.projectId);
            return (
              <li
                key={campaign.projectId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white">{campaign.title}</p>
                  <p className="mt-0.5 text-xs text-white/48">
                    <span className="font-mono">{campaign.slug}</span>
                    {' · '}
                    {stateLabel(copy, campaign.state)}
                    {campaign.creatorName != null && campaign.creatorName !== ''
                      ? ` · ${campaign.creatorName}`
                      : ''}
                  </p>
                </div>
                {already ? (
                  <Tag>{copy.alreadyIn}</Tag>
                ) : (
                  <Pill
                    variant="outline"
                    size="sm"
                    aria-label={fillPlaceholders(copy.addCampaignLabel, { title: campaign.title })}
                    onClick={() => onPick(campaign)}
                  >
                    {copy.add}
                  </Pill>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
