import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';
import { DashboardNav } from '../../../../../components/dashboard/DashboardNav';
import { dashboardMetaCopy, dashboardNavCopy } from '../../../../../lib/i18n/shell-copy.server';

/**
 * §4.7's creator dashboard — the shell #93 asks for.
 *
 * <h2>What a shell is here</h2>
 *
 * A frame and a way between its panels, and nothing else. The panels are separate issues:
 * the overview is CD-01 (#93), the charts are CD-02, CD-07 and CD-08 (#96), the backer
 * report and its export are CD-10 and CD-11 (#97, #79), and the financial summary is #99.
 * This layout is what they appear inside, and it exists so that each of them is a route
 * rather than a rewrite of a page that grew.
 *
 * <h2>The navigation lists only what exists</h2>
 *
 * Five items, and each arrived with its own route: an entry greyed out or linked to a 404
 * would be an interface advertising a product the platform does not have. `DashboardNav`
 * records the order they are read in and why the money sits after the people.
 *
 * <h2>Its words, and the metadata's, come from the catalogue</h2>
 *
 * #79. The title and the description are resolved in `generateMetadata` rather than written
 * as a constant `metadata` object, because a constant is evaluated once for every language
 * at build time and there is no request under it to read a locale from.
 *
 * <h2>Not indexed, and not a gate</h2>
 *
 * `privatePageMetadata` emits `noindex, nofollow`: this is one creator's view of their own
 * money. **The route is not an authorisation boundary.** The service refuses a caller who
 * holds no `VIEW_FINANCES` on the campaign and the panel renders that refusal — the same
 * arrangement the moderation queue uses, and for the same reason: a check here would be a
 * second, weaker copy of one the service already makes correctly, and the two would
 * eventually disagree.
 */
export async function generateMetadata(): Promise<Metadata> {
  const copy = await dashboardMetaCopy();
  return privatePageMetadata({ title: copy.title, description: copy.description });
}

export default async function DashboardLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly id: string }>;
}) {
  const [{ id }, nav] = await Promise.all([params, dashboardNavCopy()]);

  return (
    <main className="mx-auto w-full max-w-[1080px] px-5 py-10 sm:px-6 sm:py-14">
      <DashboardNav projectId={id} copy={nav} />
      <div className="mt-8">{children}</div>
    </main>
  );
}
