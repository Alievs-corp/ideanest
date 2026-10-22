import type { ReactNode } from 'react';
import { AdminArea } from '../../../components/admin/AdminArea';
import { ConsoleTheme } from '../../../components/admin/ConsoleTheme';

/**
 * The administration console's route group — §4.11, issue #294.
 *
 * <h2>A segment rather than a parenthesised group, and why that is the same thing</h2>
 *
 * Epic #259 asks for the console "under an `(admin)` route group with its own shell". A
 * route group exists to give a layout to routes that do <em>not</em> share a URL prefix —
 * which is what `(site)` is for, because `/`, `/discover` and `/categories/[category]` have
 * nothing in common in the path. Every console route is under `/admin`, so the segment
 * already is the group: `app/admin/layout.tsx` wraps exactly the same eleven routes that
 * `app/(admin)/` would, and does it without a directory level whose only content is one more
 * directory. What the epic is asking for — one shell, separate from the public one, scoped
 * to the console and to nothing else — is what this file does.
 *
 * <h2>What it deliberately does not do</h2>
 *
 * <strong>It does not gate.</strong> There is no role model in the schema or in the access
 * token until #295, so the service refuses a caller who is not on the configured moderator
 * list and each screen renders that refusal. A check in a layout would be a second, weaker
 * copy of one the service already makes correctly, and the two would eventually disagree.
 * `AdminArea` carries the argument in full.
 *
 * <strong>It declares no metadata.</strong> Every page under it uses `privatePageMetadata`,
 * which emits `noindex, nofollow` and no social card — and it has to be per page rather than
 * here, because the title is the screen's. A `robots` block at this level would be a second
 * place for the same rule, and the failure mode of two places is that one of them is
 * eventually forgotten on the surface that renders other people's email addresses.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div data-theme="dark" className="bg-surface-1 text-fg">
      <ConsoleTheme />
      <AdminArea>{children}</AdminArea>
    </div>
  );
}
