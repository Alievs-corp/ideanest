'use client';

import { useState } from 'react';
import { Link } from '../../i18n/navigation';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import {
  bodyOf,
  collectionTitle,
  isPublished,
  replaceCollection,
  type AdminCollection,
} from '../../lib/admin/curation';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { BadgeManagerCopy } from '../../lib/i18n/admin/curation-copy';
import type { NoteDialogCopy } from '../../lib/i18n/admin/common-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { NoteDialog } from './NoteDialog';
import { useCollections } from './useCollections';

/**
 * §4.11's AD-03: the editorial badge manager — issue #300.
 *
 * <h2>There is no badge table, and that is the design</h2>
 *
 * §3.2's editorial badge is not a flag on a campaign. It is a property of being in a
 * collection whose `grants_badge` is true — V14 made it a column on the collection rather than
 * on the membership deliberately, so that "which campaigns does the platform stand behind" has
 * exactly one answer and cannot drift from "which campaigns are in the staff picks".
 *
 * <p>So this screen is not a list of badges. It is <strong>the list of collections that badge
 * what is in them</strong>, and the one control it offers is whether a collection is one of
 * those. Everything else about a badge — which campaigns carry it, in what order — is
 * membership, and membership is edited on the collection.
 *
 * <h2>Granting is a decision about every campaign in the list at once</h2>
 *
 * Turning the grant on badges every campaign already in the collection, and turning it off
 * removes the badge from all of them. That is a bigger action than it looks from a switch, so
 * it goes through the same note dialog the publish decisions use, and the dialog says how many
 * campaigns it is about.
 *
 * <h2>The count comes from the index, and the index does not carry members</h2>
 *
 * `GET /v1/admin/collections` returns each collection without its membership — the count is on
 * the single-collection read. Rather than fetch every collection to put a number on this
 * screen, the row links to the collection, where the campaigns are. A number that cost sixteen
 * requests would be a number nobody asked for.
 *
 * <h2>Motion</h2>
 *
 * The dialog's 200ms entry and 150ms of colour on a control, and nothing else.
 */
export interface BadgeManagerProps {
  readonly copy: BadgeManagerCopy;
  readonly note: NoteDialogCopy;
}

export function BadgeManager({ copy, note }: BadgeManagerProps) {
  const { status, collections, error, capability, apply, reload, setError } = useCollections(
    copy.subject,
    copy.refusals,
  );

  const [pending, setPending] = useState<AdminCollection | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const granting = collections.filter((collection) => collection.grantsBadge);
  const rest = collections.filter((collection) => !collection.grantsBadge);

  async function commit(): Promise<void> {
    if (pending === null) return;

    setDialogBusy(true);
    setDialogError(null);
    setError(null);
    try {
      /*
       * `bodyOf` and one field, never a body built from the field alone: `PUT` replaces the
       * whole description, and the fields this screen is not looking at include the window
       * and the placement.
       *
       * There is no note on this request — `PUT /v1/admin/collections/{slug}` does not take
       * one, unlike publishing — so the dialog confirms without asking for a reason it would
       * only throw away.
       */
      const updated = await replaceCollection(pending.slug, {
        ...bodyOf(pending),
        grantsBadge: !pending.grantsBadge,
      });

      apply(updated);
      setNotice(
        fillPlaceholders(updated.grantsBadge ? copy.grantedNotice : copy.stoppedNotice, {
          title: collectionTitle(updated),
        }),
      );
      setPending(null);
    } catch (cause) {
      setDialogError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setDialogBusy(false);
    }
  }

  return (
    <section aria-labelledby="badges-heading">
      <h2 id="badges-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.heading}
        {status === 'ready' && (
          <span className="ml-2 text-xs font-normal text-white/40">{granting.length}</span>
        )}
      </h2>

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

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-3">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <Skeleton height="1rem" width="35%" />
                <Skeleton height="0.875rem" width="55%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && collections.length === 0 && (
        <EmptyState
          className="mt-4"
          variant="empty"
          title={copy.noCollectionsTitle}
          description={copy.noCollectionsBody}
          action={
            <Link
              href="/admin/curation"
              className="rounded-lg text-sm text-white/64 underline underline-offset-2 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
            >
              {copy.toCollections}
            </Link>
          }
        />
      )}

      {status === 'ready' && collections.length > 0 && granting.length === 0 && (
        <EmptyState
          className="mt-4"
          variant="empty"
          title={copy.emptyTitle}
          description={copy.emptyBody}
        />
      )}

      {status === 'ready' && granting.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-2">
          {granting.map((collection) => (
            <BadgeRow
              key={collection.slug}
              collection={collection}
              copy={copy}
              onToggle={() => {
                setDialogError(null);
                setPending(collection);
              }}
            />
          ))}
        </ul>
      )}

      {status === 'ready' && collections.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-medium tracking-[-0.02em] text-white">
            {copy.restHeading}
            <span className="ml-2 text-xs font-normal text-white/40">{rest.length}</span>
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm text-white/48">{copy.restIntro}</p>

          {rest.length === 0 ? (
            <p className="mt-4 text-sm text-white/40">{copy.allGrant}</p>
          ) : (
            <ul className="mt-4 flex list-none flex-col gap-2">
              {rest.map((collection) => (
                <BadgeRow
                  key={collection.slug}
                  collection={collection}
                  copy={copy}
                  onToggle={() => {
                    setDialogError(null);
                    setPending(collection);
                  }}
                />
              ))}
            </ul>
          )}
        </>
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
            : fillPlaceholders(pending.grantsBadge ? copy.stopTitle : copy.grantTitle, {
                title: collectionTitle(pending),
              })
        }
        description={
          pending?.grantsBadge === true ? copy.stopDescription : copy.grantDescription
        }
        body={copy.dialogBody}
        noteless
        confirmLabel={pending?.grantsBadge === true ? copy.stopConfirm : copy.grantConfirm}
        busyLabel={copy.curation.saving}
        destructive={pending?.grantsBadge === true}
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => {
          setPending(null);
          setDialogError(null);
        }}
        onConfirm={() => void commit()}
        copy={note}
      />
    </section>
  );
}

function BadgeRow({
  collection,
  copy,
  onToggle,
}: {
  readonly collection: AdminCollection;
  readonly copy: BadgeManagerCopy;
  readonly onToggle: () => void;
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
          {/*
            An unpublished collection that grants the badge badges nothing, because nobody can
            see the collection. Said here rather than left to be worked out: a curator who
            turned the grant on and saw no badges would otherwise reasonably think it failed.
          */}
          <Tag variant={published ? 'success' : 'default'}>
            {published
              ? copy.curation.published
              : collection.grantsBadge
                ? copy.unpublishedBadgesNothing
                : copy.curation.unpublished}
          </Tag>
        </div>
      </div>

      <div className="mt-3">
        <Pill variant="outline" size="sm" onClick={onToggle}>
          {collection.grantsBadge ? copy.stopGranting : copy.grant}
        </Pill>
      </div>
    </li>
  );
}
