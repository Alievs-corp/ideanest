import Image from 'next/image';
import { Link } from '../../i18n/navigation';
import { BadgeCheck, CalendarClock, Sparkles, Tags } from 'lucide-react';
import type { ReactNode } from 'react';
import { MediaFrame, Tag } from '@ideanest/ui/server';
import {
  COLLECTIONS_PATH,
  isOpenCall,
  windowFacts,
  type Collection,
  type CollectionKind,
} from '../../lib/collections/api';
import { COLLECTION_COVER_SIZES } from '../../lib/images/sizes';
import { canOptimise } from '../../lib/images/source';
import type { CollectionHeaderCopy } from '../../lib/i18n/collection-copy';
import { pluralise } from '../../lib/i18n/plurals';
import type { Locale } from '../../lib/i18n/locale';

/**
 * The head of a collection landing page — D-08, §4.13 WS-04.
 *
 * <h2>The trail is rendered as well as declared</h2>
 *
 * `collectionPageGraph` states it in JSON-LD for a crawler; this is the same trail for a
 * reader, and a page that only had the machine half would be one somebody lands on from a
 * search result with no way up. `aria-label` names it because the header's own `<nav>` is
 * otherwise indistinguishable from it — the rule `CategoryLanding` states for the same pair.
 *
 * <h2>What the window says, and what it deliberately does not</h2>
 *
 * A visible collection is always inside its own window: `PostgresCuratedCollections` selects
 * on `opens_at <= now()` and `closes_at > now()`, so a collection outside it is a 404 rather
 * than a page saying "closed". That is what makes "Closes 12 September 2026" a fact rather
 * than a guess.
 *
 * **It is a date and never a countdown.** The endpoint is cached for sixty seconds and this
 * page is revalidated on the same window, so a rendered "closes in 2 hours" can be two minutes
 * wrong the moment it is read — and on an open call, which is the one kind somebody acts on a
 * deadline for, being wrong about the deadline is the expensive failure.
 * docs/motion-system.md §6 makes the same call about a campaign countdown for a different
 * reason: it must not animate. Neither of these numbers should perform.
 *
 * <h2>The badge is stated, because membership means something</h2>
 *
 * §3.2 and §4.4 make an editorial badge a claim the platform makes about a campaign, and
 * `collections.grants_badge` is the column that decides whether being in this list is that
 * claim. A reader looking at a campaign carrying the badge should be able to find out where it
 * came from, and this is the page that says so. It is a sentence with an icon beside it, never
 * a colour on its own (docs/ui-kit.md §9.2).
 *
 * <h2>Motion: none, and the reason is the money</h2>
 *
 * docs/motion-system.md §5 puts a discovery surface on a minimal budget and its one allowance
 * is a single `FadeUp` on a page heading. Taking it here would pull `@ideanest/ui/motion` and
 * its 116 kB of animation runtime into a route whose whole job is to be an indexable list of
 * campaigns — the same trade the category landing pages refused. Nothing on this header moves.
 */

/** One icon per kind, so the label never carries the distinction alone. */
const KIND_ICONS: Readonly<Record<CollectionKind, ReactNode>> = Object.freeze({
  staff_selection: <Sparkles className="size-3" />,
  themed: <Tags className="size-3" />,
  open_call: <CalendarClock className="size-3" />,
});

function kindIcon(kind: string): ReactNode {
  return Object.hasOwn(KIND_ICONS, kind) ? KIND_ICONS[kind as CollectionKind] : null;
}

/*
 * WHAT THIS KIND OF LIST IS, IN ONE SENTENCE, moved to `discovery.collections.sentences` with
 * #324. The open call's is the one that earns its place: it is the only kind a creator can
 * still do something about, and "this is a programme with a deadline" is not something the
 * title alone conveys. The other two describe a list somebody browses, and the sentence is
 * short because the curator's own standfirst is the copy that matters on this page.
 *
 * A kind this build does not know has no sentence, exactly as it had none before.
 */

export interface CollectionHeaderProps {
  /**
   * The language the page is in, and the two words the window is stated with — #324.
   *
   * Props rather than a `getLocale()`/`getTranslations()` pair inside the component: these are
   * synchronous server components with tests that render them directly, and an async component
   * cannot be rendered by Testing Library. The route resolves both once and hands them down,
   * which is the arrangement every other localised value in this tree already uses.
   */
  readonly locale: Locale;
  readonly copy: CollectionHeaderCopy;
  readonly collection: Collection;
}

export function CollectionHeader({ collection, locale, copy }: CollectionHeaderProps) {
  const label = copy.kinds[collection.kind] ?? null;
  const icon = kindIcon(collection.kind);
  const facts = windowFacts(collection, locale, copy.window);
  const sentence = copy.sentences[collection.kind] ?? null;

  return (
    <header>
      <nav aria-label={copy.breadcrumb} className="text-sm text-fg-40">
        <ol className="flex list-none flex-wrap items-center gap-2">
          <li>
            <Link href={COLLECTIONS_PATH} className="hover:text-fg">
              {copy.collections}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-fg-64">
            {collection.title}
          </li>
        </ol>
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-start lg:gap-10">
        <div>
          {label !== null && (
            <div>
              <Tag className="gap-1.5">
                {icon !== null && (
                  <span aria-hidden="true" className="flex items-center">
                    {icon}
                  </span>
                )}
                {label}
              </Tag>
            </div>
          )}

          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-4xl">
            {collection.title}
          </h1>

          {collection.description !== null && collection.description !== '' && (
            <p className="mt-3 max-w-[60ch] text-fg-64">{collection.description}</p>
          )}

          {sentence !== null && (
            <p className="mt-2 max-w-[60ch] text-sm text-fg-40">{sentence}</p>
          )}

          <dl className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-fg-40">{copy.inCollection}</dt>
              <dd className="text-fg-80 tabular-nums">
                {pluralise(locale, copy.count, collection.projectCount)}
              </dd>
            </div>

            {facts.map((fact) => (
              <div key={fact.term} className="flex items-baseline gap-1.5">
                <dt className="text-fg-40">{fact.term}</dt>
                <dd className="text-fg-80">
                  <time dateTime={fact.iso}>{fact.date}</time>
                </dd>
              </div>
            ))}
          </dl>

          {collection.grantsBadge && (
            <p className="mt-4 flex max-w-[60ch] items-start gap-2 text-sm text-fg-64">
              <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-40" />
              <span>
                {copy.badge}{' '}
                {isOpenCall(collection) ? copy.badgeOpenCall : copy.badgeCurated}
              </span>
            </p>
          )}
        </div>

        {collection.image !== null && (
          /*
            THE PICTURE IS DECORATIVE AND SAYS SO. `alt=""` removes it from the accessibility
            tree, because the heading beside it is the collection's name and there is nothing
            here that could describe the cover which the curator did not already write in the
            standfirst. Omitting the attribute is the third option and the worst one — a screen
            reader then reads the file name (docs/ui-kit.md §7.16).

            The 16:9 crop reserves the box before the bytes arrive, so nothing below this
            header moves when the image decodes.
          */
          <MediaFrame ratio="16/9" radius="lg">
            <Image
              src={collection.image.url}
              alt=""
              fill
              sizes={COLLECTION_COVER_SIZES}
              unoptimized={!canOptimise(collection.image.url)}
              priority
              className="object-cover"
            />
          </MediaFrame>
        )}
      </div>
    </header>
  );
}
