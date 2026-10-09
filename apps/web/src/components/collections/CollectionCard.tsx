import Image from 'next/image';
import { Link } from '../../i18n/navigation';
import { CalendarClock, Sparkles, Tags } from 'lucide-react';
import type { ReactNode } from 'react';
import { MediaFrame, Tag } from '@ideanest/ui/server';
import {
  collectionPath,
  windowFacts,
  type Collection,
  type CollectionKind,
} from '../../lib/collections/api';
import { DISCOVERY_CARD_SIZES } from '../../lib/images/sizes';
import { canOptimise } from '../../lib/images/source';
import type { CollectionCardCopy } from '../../lib/i18n/collection-copy';
import type { Locale } from '../../lib/i18n/locale';

/**
 * One collection in the index — D-08, §4.13 WS-04.
 *
 * <h2>What a card has to say before somebody clicks it</h2>
 *
 * Four facts, and each is on the card because a reader deciding whether to open it needs it:
 * **what kind of list this is**, because applying to an open call and browsing a staff
 * selection are different acts; **what it is called and what it is for**; **how many campaigns
 * are in it**, because a collection of two and a collection of forty are different pages; and
 * **when it closes**, when it closes at all, because that is the only fact on the card with a
 * deadline attached to it.
 *
 * <h2>The kind is a word, an icon, and never a colour</h2>
 *
 * docs/ui-kit.md §9.2: colour alone must never carry meaning. So the three kinds are three
 * labels with three icons, all on the same `default` tag surface — an open call is not
 * `--warning` and a staff selection is not lime. Lime says "act now" and `--success` says
 * "achieved" (§2.4), and a curated list is neither; a reader who saw lime here and read it as
 * urgency would have been told something the page does not know.
 *
 * A kind this build does not recognise renders no tag at all rather than a fourth colour or
 * the raw wire value. `lib/collections/api.ts` explains why the field is widened.
 *
 * <h2>The cover reserves its box before it loads</h2>
 *
 * `MediaFrame` with the 16:9 crop, exactly as `ProjectCard` does and for the same reason: a
 * collection with a cover and one without are then the same height, and the grid does not
 * reflow as the pictures decode. A collection with no cover gets the reserved `--surface-3`
 * box and nothing in it — not a broken image and not a stock graphic that says nothing
 * (docs/ui-kit.md §7.16).
 *
 * `alt` is empty by decision. The title is the next element and it is the link; describing the
 * cover would be a second announcement of the same collection, and there is nothing this
 * component could invent that the curator did not write.
 *
 * <h2>No entry animation</h2>
 *
 * docs/motion-system.md §5 gives a discovery surface a minimal budget and §8 forbids animation
 * in lists outright. A grid of cards that fade in is a page that never settles, and this one is
 * read by somebody deciding what to open. The only motion is the 150ms colour change on hover,
 * which is a `background-color` transition and not a layout property.
 */

/** An icon per kind, so the label is never carrying the distinction on its own. */
const KIND_ICONS: Readonly<Record<CollectionKind, ReactNode>> = Object.freeze({
  staff_selection: <Sparkles className="size-3" />,
  themed: <Tags className="size-3" />,
  open_call: <CalendarClock className="size-3" />,
});

function kindIcon(kind: string): ReactNode {
  return Object.hasOwn(KIND_ICONS, kind) ? KIND_ICONS[kind as CollectionKind] : null;
}

export interface CollectionCardProps {
  /**
   * The language the page is in, and the two words the window is stated with — #324.
   *
   * Props rather than a `getLocale()`/`getTranslations()` pair inside the component: these are
   * synchronous server components with tests that render them directly, and an async component
   * cannot be rendered by Testing Library. The route resolves both once and hands them down,
   * which is the arrangement every other localised value in this tree already uses.
   */
  readonly locale: Locale;
  readonly copy: CollectionCardCopy;
  readonly collection: Collection;
  /**
   * Loads the cover eagerly. True for the first row of the index and nothing else — one of
   * those is the largest contentful paint on the page, and putting every cover in the
   * document's own priority queue makes all of them later.
   */
  readonly priority?: boolean;
}

export function CollectionCard({
  collection,
  locale,
  copy,
  priority = false,
}: CollectionCardProps) {
  const label = copy.kinds[collection.kind] ?? null;
  const icon = kindIcon(collection.kind);
  const facts = windowFacts(collection, locale, copy.window);

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-white/8 bg-surface-2 transition-colors duration-300 ease-in-out hover:bg-surface-3">
      <MediaFrame ratio="16/9">
        {collection.image !== null && (
          <Image
            src={collection.image.url}
            alt=""
            fill
            sizes={DISCOVERY_CARD_SIZES}
            /*
             * An address the optimiser will not fetch is served as it is rather than thrown
             * over. `next/image` raises on a URL no remote pattern matches, and a raised
             * render in a Server Component blanks the whole index — one typed-in cover must
             * not be able to do that. See `lib/images/source.ts`.
             */
            unoptimized={!canOptimise(collection.image.url)}
            priority={priority}
            className="object-cover"
          />
        )}
      </MediaFrame>

      <div className="flex flex-1 flex-col gap-3 p-5">
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

        <h3 className="text-lg font-medium tracking-[-0.02em] text-white">
          {/*
            The whole card is reachable through this one link rather than through three — a
            stretched anchor keeps the pointer target the size of the card while leaving
            exactly one tab stop and one announcement per collection.
          */}
          <Link
            href={collectionPath(collection.slug)}
            className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {collection.title}
          </Link>
        </h3>

        {collection.description !== null && collection.description !== '' && (
          <p className="text-sm text-white/64">{collection.description}</p>
        )}

        <dl className="mt-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-2 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-white/40">{copy.campaigns}</dt>
            <dd className="text-white/80 tabular-nums">{collection.projectCount}</dd>
          </div>

          {facts.map((fact) => (
            <div key={fact.term} className="flex items-baseline gap-1.5">
              <dt className="text-white/40">{fact.term}</dt>
              <dd className="text-white/80">
                {/*
                  A machine-readable instant beside the human one. The date is written out in
                  full rather than left as a countdown: this response may be a minute old
                  (the endpoint is cached for that long) and a date does not go stale in a
                  minute — see `windowFacts`.
                */}
                <time dateTime={fact.iso}>{fact.date}</time>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}
