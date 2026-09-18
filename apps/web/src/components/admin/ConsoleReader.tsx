'use client';

import { useEffect, useState } from 'react';
import { lookUpNames } from '../../lib/admin/directory';
import { wasAborted } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { AdminShellCopy } from '../../lib/i18n/admin-copy';
import { useConsoleMembership } from './ConsoleMembership';

/**
 * Who is reading the console, and with what authority — issue #405.
 *
 * <h2>The gap</h2>
 *
 * The console shell was a wordmark and a link back to the site. Who was signed in, and what
 * they were allowed to do, was answerable only by opening `/admin/staff` — which reported it
 * as `c5c5493d` until #402. So an operator moving between screens had no way of telling
 * whether a screen was refusing them because it was not theirs or because something was
 * broken, on a surface where several people share a machine and a shift.
 *
 * <h2>A line of text, not a menu</h2>
 *
 * <p>There is no sign-out here and no avatar. Signing out is the site's, in the account menu
 * this shell deliberately does not draw, and a second one in the console would be a second
 * place to keep the same behaviour correct. What was missing was the statement, not another
 * control.
 *
 * <p><strong>It imports nothing from `@ideanest/ui`.</strong> `AdminArea` records the
 * measurement: the kit's root barrel lands in one shared chunk and cost this application
 * 83.3 KiB on every route the last time somebody imported it where it did not belong. This
 * component is on all thirty console routes, so it is markup and one read.
 *
 * <h2>The membership is the shell's read, not this component's — issue #295</h2>
 *
 * <p>It used to fetch `GET /v1/admin/me` itself, which was right while it was the only thing
 * that wanted it. The gate and the rail want the same answer, so the read moved up to
 * `ConsoleMembershipProvider` and this consumes it: one request per navigation instead of
 * three, and no way for the line to name a role the rail has stopped believing in.
 *
 * <p>The name lookup stays here. It is this line's own question — `/v1/admin/directory`
 * turning an identifier into a name — and neither the gate nor the rail has any use for it.
 *
 * <h2>It renders nothing until it can say something true</h2>
 *
 * <p>No skeleton, no "loading…", and nothing at all for a visitor who is not staff. A
 * console header that flickered a placeholder on every navigation would be movement in the
 * one place docs/motion-system.md §5 gives an administrative surface none, and a name that
 * arrived a beat after the page is a name nobody was waiting for.
 *
 * <p>The roles are their own identifiers, translated — `admin.screens.staff.role` — because
 * the four are read as ordinary nouns. The capabilities are not listed: twelve chips in a
 * header is a header nobody reads, and `/admin/staff` is one click away and exists to answer
 * exactly that.
 */
export interface ConsoleReaderProps {
  readonly copy: AdminShellCopy;
}

export function ConsoleReader({ copy }: ConsoleReaderProps) {
  const { membership } = useConsoleMembership();
  const [name, setName] = useState<string | null>(null);

  // Only staff get a name looked up: the directory refuses everybody else, and asking would
  // be a 403 in the log for a header that is not going to be drawn.
  const accountId = membership?.staff === true ? membership.accountId : null;

  useEffect(() => {
    if (accountId === null) {
      setName(null);
      return;
    }

    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const directory = await lookUpNames([accountId as string], [], controller.signal);
        if (controller.signal.aborted) return;
        setName(directory.accounts[0]?.name ?? null);
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;
        /*
         * Swallowed, and the line still renders — with the shortened identifier, which is the
         * same fallback every console screen uses. This is a statement about the reader on a
         * shell wrapped around every console screen; a failed name lookup must not put an
         * error above a payout queue that loaded correctly, and must not take the roles off
         * the bar either.
         */
        setName(null);
      }
    }

    void load();
    return () => controller.abort();
  }, [accountId]);

  if (membership === null || !membership.staff) return null;

  return (
    <p className="text-sm text-white/64">
      {fillPlaceholders(copy.signedInAs, {
        // The name where the directory had one, the identifier where it did not — the same
        // fallback every console screen uses, for the same reason.
        name: name ?? membership.accountId.slice(0, 8),
        roles: membership.roles.map((role) => copy.role[role] ?? role).join(', '),
      })}
    </p>
  );
}
