import { Link } from '../../i18n/navigation';
import { EmptyState } from '@ideanest/ui/server';
import type { Collection } from '../../lib/collections/api';
import { CollectionCard } from './CollectionCard';
import type { CollectionIndexCopy } from '../../lib/i18n/collection-copy';
import type { Locale } from '../../lib/i18n/locale';

/**
 * The body of `/collections` — D-08, §4.13 WS-04.
 *
 * <h2>It is the crawl path</h2>
 *
 * A collection landing page is worth building only if something links to it. §4.13 disallows
 * `/discover?` wholesale, the web feed exposes no `programme` filter, and a curated order is
 * not something a filter could express in any case — so before this page existed there was no
 * URL on the site that reached a collection. This is the one place that lists every visible
 * one as an ordinary link, which is what stops the landing pages being orphans in the sitemap.
 *
 * <h2>The order is the curator's, and the kinds are not separated</h2>
 *
 * `GET /v1/collections` answers in `sort_order`, which is a decision a curator made about what
 * the platform wants read first. Regrouping them here — open calls in one band, staff
 * selections in another — would overrule that decision in the client, and it would do it
 * invisibly: the person who set the order would see a different page from the one they
 * arranged. So there is one grid, and each card says what kind of list it is
 * (`CollectionCard`).
 *
 * <h2>A refused read and an empty platform look the same, and the page does not pretend
 * otherwise</h2>
 *
 * `fetchCollections` answers `null` for a service that refused or could not be reached, and an
 * empty array for a platform with nothing curated yet. Both render the same way here, because
 * the one useful thing to say is the same in both cases: the feed is reachable and carries
 * every campaign on the platform. `app/(site)/categories/page.tsx` takes the same line.
 *
 * <h2>Motion: none</h2>
 *
 * No `FadeUp`, matching the category landing pages beside it. Discovery's budget allows one on
 * a page heading (docs/motion-system.md §5.1) and taking it here would cost the whole route
 * 116 kB of animation runtime — `FadeUp` lives behind `@ideanest/ui/motion` — on a page whose
 * entire purpose is to be a fast, indexable, server-rendered list of links. §8's target is the
 * one that wins: this is a discovery surface, and speed outranks the fade.
 */

export interface CollectionIndexProps {
  /**
   * The language the page is in, and the two words the window is stated with — #324.
   *
   * Props rather than a `getLocale()`/`getTranslations()` pair inside the component: these are
   * synchronous server components with tests that render them directly, and an async component
   * cannot be rendered by Testing Library. The route resolves both once and hands them down,
   * which is the arrangement every other localised value in this tree already uses.
   */
  readonly locale: Locale;
  readonly copy: CollectionIndexCopy;
  /** `null` when the read was refused. See the component comment. */
  readonly collections: readonly Collection[] | null;
}

export function CollectionIndex({ collections, locale, copy }: CollectionIndexProps) {
  const items = collections ?? [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-4xl">
        {copy.title}
      </h1>
      <p className="mt-2 max-w-[60ch] text-fg-64">{copy.intro}</p>

      <div className="mt-12">
        {items.length === 0 ? (
          /*
            `empty`, not `filtered`. Nothing here is a filter the reader chose — they followed
            a link to an index that happens to have nothing in it — and telling them to clear a
            filter would be telling them to undo something they did not do.
          */
          <EmptyState
            variant="empty"
            headingLevel={2}
            title={copy.emptyTitle}
            description={copy.emptyBody}
            action={
              <Link
                href="/discover"
                className="inline-flex h-10 items-center rounded-full bg-inverse px-5 text-sm font-medium text-on-inverse transition-colors duration-150 ease-in-out hover:bg-inverse-muted"
              >
                {copy.emptyAction}
              </Link>
            }
          />
        ) : (
          <ul
            /*
              Named, because the heading is outside the list and a screen-reader user landing
              on it out of context is otherwise told only "list, 6 items".
            */
            aria-label={copy.listLabel}
            className="grid list-none grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {items.map((collection, index) => (
              <li key={collection.id} className="flex">
                <div className="flex w-full">
                  {/* The first row is above the fold at every breakpoint this grid has. */}
                  <CollectionCard
                    collection={collection}
                    locale={locale}
                    copy={copy.card}
                    priority={index < 3}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
