import type { Metadata } from 'next';
import { PrelaunchView } from '../../../../../components/prelaunch/PrelaunchView';
import { projectPageMetadata } from '../../../../../lib/seo/metadata';
import { fetchPublicProjectPreview } from '../../../../../lib/seo/metadata-source';
import { localeOrDefault } from '../../../../../lib/i18n/locale';
import { prelaunchCopy } from '../../../../../lib/i18n/shell-copy.server';
import { getLocale } from 'next-intl/server';

/**
 * The title, description, canonical, and social card of one campaign's public
 * pre-launch page.
 *
 * **This is a link that goes into a social post.** That is the whole reason the
 * route exists outside `/edit`, and until now the page had a generic title —
 * "Coming soon" — for every campaign on the site, so every creator who shared
 * theirs shared a card that named somebody else's too. The comment that used to
 * sit here said a per-campaign title needed a server-rendered public projection
 * and left it to the campaign-page epic. It needed one fetch, not a rendered page,
 * and #120 is where it belongs.
 *
 * **The PAGE is still a client boundary and this changes nothing about that.**
 * `PrelaunchView` still reads the campaign in the browser through `publicFetch`,
 * because it also reads the follower count and posts the reminder. Server-rendering
 * the page itself is #119's. What happens here is a single anonymous read of the
 * public projection, for the `<head>` only.
 *
 * **A campaign that cannot be confirmed public gets no title, no description, and
 * `noindex`** — see `projectPageMetadata` and `fetchPublicProjectPreview`, which
 * each explain their half. The failure mode is a card that says nothing, never a
 * card that says something private.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const preview = await fetchPublicProjectPreview(id);

  return projectPageMetadata(
    preview,
    `/projects/${encodeURIComponent(id)}/prelaunch`,
    localeOrDefault(locale),
  );
}

/**
 * The public pre-launch page — the address a creator shares.
 *
 * NOT under `/edit`, deliberately: this is a link that goes into a social post,
 * and one with "edit" in it invites questions and looks like a mistake.
 */
export default async function PublicPrelaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /*
   * No wrapper since #343. This used to be a `<main>`; the layout beside this file now puts
   * the page inside `SiteShell`, which owns the only `<main>` on the document, and
   * `PrelaunchView` draws its own column and padding — so the element that was here carried
   * a landmark and nothing else.
   */
  return (
    <PrelaunchView
      projectId={id}
      copy={await prelaunchCopy()}
      locale={localeOrDefault(await getLocale())}
    />
  );
}
