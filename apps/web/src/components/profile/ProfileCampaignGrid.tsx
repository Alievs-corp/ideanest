'use client';

import { useState } from 'react';
import { FolderOpen, HeartHandshake } from 'lucide-react';
import { EmptyState, InlineAlert, Pill } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import type { Page } from '../../lib/community/signals';
import {
  listBackedProjects,
  listCreatedProjects,
  type ProfileProjectCard,
} from '../../lib/profiles/api';
import { PROFILE_CAMPAIGN_GRID } from '../browse/campaign-grid-layout';
import { ProfileCampaignCard } from './ProfileCampaignCard';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ProfileGridCopy } from '../../lib/i18n/profile-copy';

/**
 * One profile tab's list of campaigns — §4.2 P-04 and P-05, issue #274.
 *
 * <h2>It is seeded by the server and never refetches its first page</h2>
 *
 * `useCursorList` in `components/account` is the same machine and is deliberately not used
 * here, because it reads on mount from a null cursor. This list already has its first page:
 * `app/u/[slug]/page.tsx` fetched it on the server so that the campaigns are in the HTML a
 * crawler and a slow connection receive. Handing that page to the account hook would mean
 * requesting the same twenty-four rows a second time on every visit, and briefly rendering a
 * skeleton over content that is already on screen.
 *
 * So this holds the seed and only ever asks for what comes after it. Everything else — the
 * opaque cursor, the append, the "the next page did not load" message that does not destroy
 * the pages already read — is the same behaviour, restated in the twenty lines that are
 * actually different.
 *
 * <h2>Which reader it uses is decided from a string, not passed in</h2>
 *
 * A function prop cannot cross a server-to-client boundary, and this component is rendered
 * from a Server Component. `kind` is the serialisable version of that choice and it is also
 * what decides whether money may be printed — see `ProfileCampaignCard`, which requires the
 * caller to say so in writing.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in long lists, and appended pages are exactly
 * the case it names. The button changes its label while it waits; nothing moves.
 */

export type ProfileListKind = 'created' | 'backed';

export interface ProfileCampaignGridProps {
  readonly slug: string;
  readonly kind: ProfileListKind;
  /**
   * The first page, fetched on the server, or `null` when that read was refused.
   *
   * **`null` is not an empty list**, and the two render differently: an empty list is a person
   * who has backed nothing, and `null` is a service that did not answer. A grid that could not
   * tell them apart would print "nothing here yet" over a restarting service and say something
   * false about somebody. Never re-requested — see the component comment.
   */
  readonly initial: Page<ProfileProjectCard> | null;
  /** The person's own name, for the empty state's wording. */
  readonly name: string;
  /** Every word this list and its cards draw — see `lib/i18n/profile-copy.ts`. */
  readonly copy: ProfileGridCopy;
  /** The language, passed to each card for its backer count. */
  readonly locale: Locale;
}

function messageFor(cause: unknown, copy: ProfileGridCopy): string {
  /*
   * The service's own sentence where there is one (§10.4). What is in the catalogue is what
   * this application says when the service said nothing.
   */
  if (cause instanceof ApiError) {
    return cause.problem?.detail ?? cause.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

export function ProfileCampaignGrid({
  slug,
  kind,
  initial,
  name,
  copy,
  locale,
}: ProfileCampaignGridProps) {
  const [items, setItems] = useState<readonly ProfileProjectCard[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore(): Promise<void> {
    if (cursor === null || loading) return;

    setLoading(true);
    setError(null);
    try {
      const page =
        kind === 'created'
          ? await listCreatedProjects(slug, cursor)
          : await listBackedProjects(slug, cursor);

      /* Appended, and the cursor advances with it. A failure leaves both alone, so a reader
         who has loaded four pages keeps four pages. */
      setItems((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      setLoading(false);
    }
  }

  if (initial === null) {
    return (
      <InlineAlert variant="danger" title={copy.failedTitle}>
        <p>{copy.failedBody}</p>
      </InlineAlert>
    );
  }

  if (items.length === 0) {
    return kind === 'created' ? (
      <EmptyState
        icon={<FolderOpen aria-hidden="true" className="size-6" />}
        title={copy.createdEmptyTitle}
        description={fillPlaceholders(copy.createdEmptyBody, { name })}
      />
    ) : (
      <EmptyState
        icon={<HeartHandshake aria-hidden="true" className="size-6" />}
        title={copy.backedEmptyTitle}
        description={fillPlaceholders(copy.backedEmptyBody, { name })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <ul className={PROFILE_CAMPAIGN_GRID}>
        {items.map((card, index) => (
          <li key={card.id} className="flex">
            <div className="flex w-full">
              <ProfileCampaignCard
                card={card}
                copy={copy.card}
                locale={locale}
                /* The one line that enforces P-04. See `ProfileCampaignCard`. */
                funding={kind === 'created' ? 'shown' : 'withheld'}
                /* The first row is above the fold on every breakpoint this grid has. */
                priority={index < 3}
              />
            </div>
          </li>
        ))}
      </ul>

      {cursor !== null && (
        <div>
          <Pill
            type="button"
            variant="outline"
            disabled={loading}
            /* The name says which list it extends: two buttons called "Show more" in one
               document is two buttons a screen reader cannot tell apart (§9.4). */
            aria-label={kind === 'created' ? copy.showMoreCreated : copy.showMoreBacked}
            onClick={() => void loadMore()}
          >
            {loading ? copy.loading : copy.showMore}
          </Pill>
        </div>
      )}

      {error !== null && (
        <InlineAlert variant="danger" title={copy.nextFailedTitle}>
          <p>{error}</p>
        </InlineAlert>
      )}
    </div>
  );
}
