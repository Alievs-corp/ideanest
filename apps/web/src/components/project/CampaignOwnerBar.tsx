'use client';

import { Link } from '../../i18n/navigation';
import { useSession } from '../session/SessionProvider';
import { OWNER_LINK_CLASS } from './owner-link';

export interface CampaignOwnerBarCopy {
  /** Names the bar, and is its visible caption. */
  readonly label: string;
  readonly dashboard: string;
  readonly edit: string;
}

export interface CampaignOwnerBarProps {
  /** The campaign's creator, compared with the signed-in account's slug. */
  readonly creatorSlug: string;
  readonly editHref: string;
  /** `null` before the campaign has launched: a pre-launch page has no dashboard worth opening. */
  readonly dashboardHref: string | null;
  readonly copy: CampaignOwnerBarCopy;
}

/**
 * The creator's way from their public page to the screens that manage it — issue #141.
 *
 * <h2>Decided in the browser, on purpose</h2>
 *
 * The campaign page is public and cached under the campaign's tag, one document for every
 * reader. Deciding "is this the owner" on the server would make that document differ by
 * cookie, which is either a cache split per reader or, worse, one owner's links cached and
 * served to everybody. So the server renders nothing here, and the bar appears only after
 * `SessionProvider` has read `GET /v1/me` and the account's slug is the campaign's creator.
 *
 * <p>Nothing is disclosed by getting it wrong: both addresses are guarded by the service,
 * which refuses a caller without the capability, and they carry only the campaign's id,
 * which the page already exposes to its own scripts.
 *
 * <p>The creator only, not a collaborator. The session carries no capability list, and a
 * collaborator reaches the editor from **My campaigns** — the bar would need a second
 * request on every view of every campaign to widen that, on the route #119 is about.
 */
export function CampaignOwnerBar({ creatorSlug, editHref, dashboardHref, copy }: CampaignOwnerBarProps) {
  const { status, session } = useSession();
  if (status !== 'signed-in' || session === null || session.slug !== creatorSlug) return null;

  return (
    <nav
      aria-label={copy.label}
      className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-surface-2 px-4 py-3"
    >
      <span aria-hidden="true" className="mr-auto text-sm text-white/64">
        {copy.label}
      </span>
      {dashboardHref !== null && (
        <Link href={dashboardHref} className={OWNER_LINK_CLASS}>
          {copy.dashboard}
        </Link>
      )}
      <Link href={editHref} className={OWNER_LINK_CLASS}>
        {copy.edit}
      </Link>
    </nav>
  );
}
