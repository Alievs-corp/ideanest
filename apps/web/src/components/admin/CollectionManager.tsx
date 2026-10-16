'use client';

import { useState } from 'react';
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
  TextInput,
} from '@ideanest/ui';
import {
  COLLECTION_KINDS,
  collectionTitle,
  createCollection,
  handleProblem,
  isPublished,
  nextSortOrder,
  publishCollection,
  unpublishCollection,
  type AdminCollection,
  type CollectionKind,
} from '../../lib/admin/curation';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { CollectionManagerCopy } from '../../lib/i18n/admin/curation-copy';
import type { NoteDialogCopy } from '../../lib/i18n/admin/common-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { NoteDialog } from './NoteDialog';
import { useCollections } from './useCollections';

/** What the manager is about to do to one collection, once a note has been typed. */
type Pending = { readonly collection: AdminCollection; readonly action: 'publish' | 'unpublish' };

export interface CollectionManagerProps {
  /**
   * Draws only the collections this returns true for, and says so in the empty state.
   *
   * <p>Absent on `/admin/curation`, which is every collection there is. Set on the three
   * screens that are the same manager asking a narrower question — the badge screen, the open
   * calls, the placement editor — because §4.3's three kinds are one table with a `kind`
   * column, and V14's own header says why: they differ in what the list means to a reader and
   * in nothing else.
   */
  readonly only?: (collection: AdminCollection) => boolean;
  /** What to say when the filter matches nothing, in the screen's own words. */
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  /** Offers the create form. Off on the three narrowed screens — see the docblock. */
  readonly allowCreate?: boolean;
  readonly copy: CollectionManagerCopy;
  readonly note: NoteDialogCopy;
}

/**
 * §4.11's AD-03: editorial collections and what is in them — issue #301.
 *
 * <h2>One component, four screens</h2>
 *
 * `/admin/curation` is this with no filter. `/admin/curation/badges` (#300),
 * `/open-calls` (#302) and `/placements` (#303) are this with one, plus whatever each of them
 * adds. That is not a shortcut: V14 put all three kinds of curated list in one table
 * deliberately, because a staff selection, a themed list and an open call have the same slug,
 * copy, publication decision, window, imagery and membership behind them. Four components
 * would have been the same file with a constant changed, and the copy that got the next fix
 * would have been whichever one somebody was looking at.
 *
 * <h2>Creating is here and nowhere else</h2>
 *
 * A new collection is created unpublished and empty, and its <strong>handle is
 * permanent</strong> — it is half of `/collections/{slug}`, a URL the platform will have put
 * in front of people. The form says so before the field rather than after the refusal, and the
 * three narrowed screens do not offer it: creating a collection from the badge screen would
 * mean guessing which kind it is, and getting that wrong is not correctable through this API.
 *
 * <h2>There is no delete, and the screen says why</h2>
 *
 * `curation_events.collection_id` has no `ON DELETE` clause, on purpose: a collection anything
 * has happened to carries the record of it. Withdrawing one unpublishes it — the public gets a
 * 404 and the reasoning stays intact — and that is the whole of the removal path.
 *
 * <h2>Motion</h2>
 *
 * The dialog's 200ms entry and 150ms of colour on a control. docs/motion-system.md §5's budget
 * for a working surface, and §8 rules out animating a list regardless.
 */
export function CollectionManager({
  only,
  emptyTitle,
  emptyDescription,
  allowCreate = false,
  copy,
  note,
}: CollectionManagerProps) {
  const { status, collections, error, capability, apply, reload, setError } = useCollections(
    copy.subject,
    copy.refusals,
  );

  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<CollectionKind>('staff_selection');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const visible = only === undefined ? collections : collections.filter(only);

  async function commit(note: string): Promise<void> {
    if (pending === null) return;

    setDialogBusy(true);
    setDialogError(null);
    setError(null);
    try {
      const updated =
        pending.action === 'publish'
          ? await publishCollection(pending.collection.slug, note)
          : await unpublishCollection(pending.collection.slug, note);

      apply(updated);
      setNotice(
        fillPlaceholders(
          pending.action === 'publish' ? copy.publishedNotice : copy.unpublishedNotice,
          { title: collectionTitle(updated) },
        ),
      );
      setPending(null);
    } catch (cause) {
      // The dialog stays open with the note still in it: nothing changed, and retyping a
      // reason is the last thing a refused curator should have to do.
      setDialogError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setDialogBusy(false);
    }
  }

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const handle = slug.trim();
    const heading = title.trim();
    if (handle === '' || heading === '') return;

    const problem = handleProblem(handle);
    if (problem !== null) {
      setHandleError(copy.handleErrors[problem]);
      return;
    }

    setHandleError(null);
    setCreating(true);
    setError(null);
    try {
      /*
       * `az` and not `en`. §21.1 makes Azerbaijani the platform's own language and the
       * taxonomy's resolution chain falls back to it, so a collection whose only copy is
       * English resolves to its slug for every reader who has not asked for English.
       */
      await createCollection(handle, {
        kind,
        copy: { az: { title: heading } },
        sortOrder: nextSortOrder(collections),
      });
      setSlug('');
      setTitle('');
      setNotice(fillPlaceholders(copy.createdNotice, { title: heading }));
      reload();
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section aria-labelledby="collections-heading">
      {allowCreate && (
        <form
          onSubmit={(event) => void create(event)}
          className="rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5"
        >
          <h3 className="text-sm font-medium text-white">{copy.newHeading}</h3>
          <p className="mt-1 max-w-[62ch] text-sm text-white/48">{copy.newIntro}</p>

          <div className="mt-4 grid items-start gap-3 sm:grid-cols-3">
            <Field label={copy.handleLabel} required hint={copy.handleHint} error={handleError}>
              <TextInput
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setHandleError(null);
                }}
                placeholder="autumn-picks"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field label={copy.titleLabel} required hint={copy.titleHint}>
              <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label={copy.kindLabel}>
              <Select
                value={kind}
                onChange={(event) => setKind(event.target.value as CollectionKind)}
              >
                {COLLECTION_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {copy.curation.kind[option]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Pill
            type="submit"
            variant="outline"
            size="sm"
            disabled={creating || slug.trim() === '' || title.trim() === ''}
            className="mt-4"
          >
            {creating ? copy.creating : copy.create}
          </Pill>
        </form>
      )}

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

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 id="collections-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.heading}
          {status === 'ready' && (
            <span className="ml-2 text-xs font-normal text-white/40">{visible.length}</span>
          )}
        </h2>
      </div>

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="35%" />
                <Skeleton height="0.875rem" width="55%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && visible.length === 0 && (
        <EmptyState
          className="mt-6"
          variant={only === undefined ? 'empty' : 'filtered'}
          title={emptyTitle ?? copy.emptyTitle}
          description={emptyDescription ?? copy.emptyBody}
        />
      )}

      {status === 'ready' && visible.length > 0 && (
        <ul className="mt-6 flex list-none flex-col gap-2">
          {visible.map((collection) => (
            <CollectionRow
              key={collection.slug}
              collection={collection}
              copy={copy}
              onPublish={() => {
                setDialogError(null);
                setPending({ collection, action: 'publish' });
              }}
              onUnpublish={() => {
                setDialogError(null);
                setPending({ collection, action: 'unpublish' });
              }}
            />
          ))}
        </ul>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={reload}>
          {copy.tryAgain}
        </Pill>
      )}

      <NoteDialog
        title={
          pending === null
            ? null
            : fillPlaceholders(
                pending.action === 'publish' ? copy.publishTitle : copy.unpublishTitle,
                { title: collectionTitle(pending.collection) },
              )
        }
        description={
          pending?.action === 'publish' ? copy.publishDescription : copy.unpublishDescription
        }
        body={
          pending?.action === 'publish' && pending.collection.grantsBadge
            ? copy.publishBadgeBody
            : undefined
        }
        confirmLabel={pending?.action === 'publish' ? copy.publish : copy.takeDown}
        busyLabel={pending?.action === 'publish' ? copy.publishing : copy.takingDown}
        destructive={pending?.action === 'unpublish'}
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => {
          setPending(null);
          setDialogError(null);
        }}
        onConfirm={(text) => void commit(text)}
        copy={note}
      />
    </section>
  );
}

/**
 * One collection in the list.
 *
 * <p>The publication state is a word and a token, never a token alone (docs/ui-kit.md §9.2),
 * and "Unpublished" is drawn neutral rather than in `--danger`: a list somebody is still
 * assembling is the normal state of a new collection, not a fault.
 *
 * <p><strong>The badge grant is called out separately from the kind.</strong> V14 made them
 * two columns on purpose — a staff selection is the usual carrier of §3.2's badge and does not
 * imply it — and a curator who reads "Staff selection" and assumes the badge follows is the
 * person this row exists to correct.
 */
function CollectionRow({
  collection,
  copy,
  onPublish,
  onUnpublish,
}: {
  readonly collection: AdminCollection;
  readonly copy: CollectionManagerCopy;
  readonly onPublish: () => void;
  readonly onUnpublish: () => void;
}) {
  const published = isPublished(collection);

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/curation/${encodeURIComponent(collection.slug)}`}
            className="rounded-lg text-[15px] font-medium text-white underline-offset-2 transition-colors duration-150 ease-in-out hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {collectionTitle(collection)}
          </Link>
          <p className="mt-1 font-mono text-xs text-white/40">/collections/{collection.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tag>{copy.curation.kind[collection.kind]}</Tag>
          {collection.grantsBadge && <Tag variant="warning">{copy.curation.grantsBadge}</Tag>}
          <Tag variant={published ? 'success' : 'default'}>
            {published ? copy.curation.published : copy.curation.unpublished}
          </Tag>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill variant="outline" size="sm" onClick={published ? onUnpublish : onPublish}>
          {published ? copy.takeDown : copy.publish}
        </Pill>
        <Link
          href={`/admin/curation/${encodeURIComponent(collection.slug)}`}
          className="rounded-lg px-2 text-sm text-white/64 underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {copy.manage}
        </Link>
      </div>
    </li>
  );
}
