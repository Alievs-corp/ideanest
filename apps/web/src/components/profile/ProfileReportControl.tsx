'use client';

import { ReportControl } from '../moderation/ReportControl';
import type { ReportControlCopy } from '../../lib/i18n/report-copy';
import { useSession } from '../session/SessionProvider';

/**
 * "Report this account" on a public profile — issue #143.
 *
 * `ReportControl` already took an account target and had nowhere to be mounted: the profile
 * carries a slug and no account id, and the endpoint wanted an id. The endpoint is now
 * `POST /v1/users/{slug}/report`, so the profile can supply what it needs.
 *
 * The only thing this wrapper adds is that **the owner is not offered it**. Reporting yourself
 * is a 400 the service refuses (`SelfReportException`), and a control that can only fail does
 * not belong on somebody's view of their own page. While the session is still unknown the
 * control is drawn, for `ReportControl`'s own reason: hiding it for that moment would make it
 * appear under the reader's cursor a beat later.
 */
export interface ProfileReportControlProps {
  readonly slug: string;
  readonly name: string;
  readonly returnTo: string;
  readonly copy: ReportControlCopy;
  /** The wrapper's spacing, so the owner's page is not left with an empty rule. */
  readonly className?: string;
}

export function ProfileReportControl({
  slug,
  name,
  returnTo,
  copy,
  className,
}: ProfileReportControlProps) {
  const { session } = useSession();
  if (session !== null && session.slug === slug) return null;

  return (
    <div className={className}>
      <ReportControl target={{ kind: 'account', slug }} name={name} returnTo={returnTo} copy={copy} />
    </div>
  );
}
