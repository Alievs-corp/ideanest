'use client';

import { useState } from 'react';
import { Link } from '../../i18n/navigation';
import {
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  TextInput,
} from '@ideanest/ui';
import {
  bodyOf,
  collectionTitle,
  isPublished,
  isWindowOpen,
  replaceCollection,
  type AdminCollection,
} from '../../lib/admin/curation';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { OpenCallManagerCopy } from '../../lib/i18n/admin/curation-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useCollections } from './useCollections';

/**
 * §4.11's AD-03: themed programmes and their windows — issue #302.
 *
 * <h2>What makes an open call different from the other two kinds</h2>
 *
 * §4.3 calls these Programmes: a themed list with a window it is open in. The kind is what
 * `?programme=` on `/v1/discover` narrows to, and the window is the reason — a staff selection
 * and a themed list are things a reader browses, and an open call is something a campaign is
 * <em>part of</em>, which means there is a date after which it stops accepting entries.
 *
 * <p>So the window is what this screen edits, and it is the only screen that does. A date on a
 * collection nobody can see is inert; a date on a published open call decides whether it
 * appears at all — the public read excludes a collection whose window has closed, which is why
 * a closed programme silently disappears from the site rather than showing as finished.
 *
 * <h2>Dates cross as instants and are typed as days</h2>
 *
 * The contract carries `opensAt` and `closesAt` as ISO-8601 instants, and a curator thinks in
 * days. The field is a `date` input and the value is turned into an instant at the boundary —
 * midnight UTC, stated on the screen rather than left to be discovered when a programme closes
 * four hours before somebody expected. §21.2 gives the platform one timezone-free convention
 * and this follows it.
 *
 * <h2>Both halves are optional, and clearing one means something</h2>
 *
 * A programme with no `opensAt` has always been open; one with no `closesAt` does not close.
 * Emptying a field sends null rather than omitting it, which is the difference between "this
 * never closes" and "leave the closing date as it was" — and `bodyOf` is what makes that
 * distinction expressible at all, because `PUT` replaces the whole description.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's budget for a working surface: 150ms of colour on a control.
 */
export interface OpenCallManagerProps {
  readonly copy: OpenCallManagerCopy;
}

export function OpenCallManager({ copy }: OpenCallManagerProps) {
  const { status, collections, error, capability, apply, reload, setError } = useCollections(
    copy.subject,
    copy.refusals,
  );
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const openCalls = collections.filter((collection) => collection.kind === 'open_call');
  const now = new Date();

  async function saveWindow(
    collection: AdminCollection,
    opensAt: string | null,
    closesAt: string | null,
  ): Promise<void> {
    setSavingSlug(collection.slug);
    setError(null);
    try {
      const updated = await replaceCollection(collection.slug, {
        ...bodyOf(collection),
        opensAt,
        closesAt,
      });
      apply(updated);
      setNotice(fillPlaceholders(copy.savedNotice, { title: collectionTitle(updated) }));
    } catch (cause) {
      setError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setSavingSlug(null);
    }
  }

  return (
    <section aria-labelledby="open-calls-heading">
      <h2 id="open-calls-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.heading}
        {status === 'ready' && (
          <span className="ml-2 text-xs font-normal text-white/40">{openCalls.length}</span>
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
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && openCalls.length === 0 && (
        <EmptyState
          className="mt-4"
          variant="filtered"
          title={copy.emptyTitle}
          description={copy.emptyBody}
        />
      )}

      {status === 'ready' && openCalls.length > 0 && (
        <ul className="mt-4 flex list-none flex-col gap-3">
          {openCalls.map((collection) => (
            <OpenCallRow
              key={collection.slug}
              collection={collection}
              now={now}
              copy={copy}
              busy={savingSlug === collection.slug}
              onSave={(opensAt, closesAt) => void saveWindow(collection, opensAt, closesAt)}
            />
          ))}
        </ul>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={reload}>
          {copy.tryAgain}
        </Pill>
      )}
    </section>
  );
}

/** `2026-08-24T00:00:00Z` from `2026-08-24`, or null from an empty field. */
function instantOf(day: string): string | null {
  return day === '' ? null : new Date(`${day}T00:00:00.000Z`).toISOString();
}

/** `2026-08-24` from an instant, for the `date` input. */
function dayOf(instant: string | null | undefined): string {
  if (instant == null) return '';
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/**
 * One programme, and the two dates that decide whether it is running.
 *
 * <p>The state line says what the window <em>means</em> rather than repeating the dates
 * underneath: "open", "not yet", "closed". A curator reading a list of eight programmes is
 * asking which are running, and two ISO dates make that a subtraction the reader has to do.
 *
 * <p><strong>A closed programme is drawn neutral, not in `--danger`.</strong> Finishing is
 * what a programme is for. What the line does say is that the public cannot see it any more,
 * because that is the surprising half.
 */
function OpenCallRow({
  collection,
  now,
  copy,
  busy,
  onSave,
}: {
  readonly collection: AdminCollection;
  readonly now: Date;
  readonly copy: OpenCallManagerCopy;
  readonly busy: boolean;
  readonly onSave: (opensAt: string | null, closesAt: string | null) => void;
}) {
  const [opens, setOpens] = useState(() => dayOf(collection.opensAt));
  const [closes, setCloses] = useState(() => dayOf(collection.closesAt));

  const published = isPublished(collection);
  const running = isWindowOpen(collection, now);
  const notYet = collection.opensAt != null && new Date(collection.opensAt) > now;
  const changed = opens !== dayOf(collection.opensAt) || closes !== dayOf(collection.closesAt);
  const backwards = opens !== '' && closes !== '' && closes <= opens;

  return (
    <li className="rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5">
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
          <Tag variant={running ? 'success' : 'default'}>
            {running ? copy.open : notYet ? copy.notYet : copy.closed}
          </Tag>
          <Tag variant={published ? 'success' : 'default'}>
            {published ? copy.curation.published : copy.curation.unpublished}
          </Tag>
        </div>
      </div>

      {published && !running && (
        <p className="mt-2 text-sm text-white/48">{copy.outsideWindow}</p>
      )}

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (backwards) return;
          onSave(instantOf(opens), instantOf(closes));
        }}
      >
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label={copy.opensLabel} hint={copy.opensHint}>
            <TextInput type="date" value={opens} onChange={(event) => setOpens(event.target.value)} />
          </Field>
          <Field
            label={copy.closesLabel}
            hint={copy.closesHint}
            error={backwards ? copy.closesBeforeOpens : undefined}
          >
            <TextInput
              type="date"
              value={closes}
              min={opens === '' ? undefined : opens}
              onChange={(event) => setCloses(event.target.value)}
            />
          </Field>
        </div>
        <Pill
          type="submit"
          variant="outline"
          size="sm"
          disabled={busy || !changed || backwards}
          className="mt-4"
        >
          {busy ? copy.curation.saving : copy.saveWindow}
        </Pill>
      </form>

      <p className="mt-2 text-xs text-white/32">{copy.utcNote}</p>
    </li>
  );
}
