import Image from 'next/image';
import type { ReactNode } from 'react';
import type { Category } from '../../lib/categories/api';
import { diffSequences, diffStory, diffText, foldUnchanged, storyLines, type DiffKind, type DiffPart, type StoryLine } from '../../lib/admin/revision-diff';
import { REVISION_FIELDS, type ProjectEdit, type RevisionField } from '../../lib/admin/revisions';
import { regionNames } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import type { RevisionReviewCopy } from '../../lib/i18n/admin/revision-copy';

/**
 * The live campaign beside the proposed one, field by field — issue #560, part of epic #557.
 *
 * <h2>Colour never carries the change alone</h2>
 *
 * Removed text is struck through and added text is underlined, each with a surface tint, and a
 * screen reader hears "Removed:" or "Added:" before the span (docs/ui-kit.md accessibility: colour
 * alone must never carry meaning). Whole blocks and pictures get the same tint on a border
 * plus the same spoken marker.
 *
 * <h2>Only what changed</h2>
 *
 * A field the creator did not touch is not drawn, because the review is of the edit and the
 * campaign's own page is one link away. The service names the changed fields; a field it names
 * that this screen does not know is ignored rather than guessed at.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in long content.
 */
export interface RevisionComparisonProps {
  readonly live: ProjectEdit;
  readonly proposed: ProjectEdit;
  readonly changedFields: readonly string[];
  readonly categories: readonly Category[] | null;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
  /** The reward tiers are drawn beside this, so an edit that changes only them is not "no changes". */
  readonly hasRewards?: boolean;
}

export const REMOVED_CLASS = 'bg-danger/12 text-fg line-through decoration-danger decoration-2';
export const ADDED_CLASS = 'bg-success/12 text-fg underline decoration-success decoration-2 underline-offset-2';
export const BLOCK_REMOVED = 'border-danger bg-danger/12';
export const BLOCK_ADDED = 'border-success bg-success/12';

export function RevisionComparison({
  live,
  proposed,
  changedFields,
  categories,
  locale,
  copy,
  hasRewards = false,
}: RevisionComparisonProps) {
  const fields = REVISION_FIELDS.filter((field) => field !== 'rewards' && changedFields.includes(field));

  if (fields.length === 0) return hasRewards ? null : <p className="mt-4 text-sm text-fg-64">{copy.noChanges}</p>;

  return (
    <div className="mt-4 space-y-8">
      {fields.map((field) => (
        <section key={field} aria-labelledby={`revision-field-${field}`}>
          <h3 id={`revision-field-${field}`} className="text-base font-medium tracking-[-0.02em] text-fg">
            {copy.fields[field]}
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Pane heading={copy.liveHeading} field={copy.fields[field]}>
              {renderSide('live', field, live, proposed, categories, locale, copy)}
            </Pane>
            <Pane heading={copy.proposedHeading} field={copy.fields[field]}>
              {renderSide('proposed', field, live, proposed, categories, locale, copy)}
            </Pane>
          </div>
        </section>
      ))}
    </div>
  );
}

export function Pane({
  heading,
  field,
  children,
}: {
  readonly heading: string;
  readonly field: string;
  readonly children: ReactNode;
}) {
  return (
    <div role="group" aria-label={`${heading}: ${field}`} className="min-w-0 rounded-lg border border-fg/8 bg-surface-1 p-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.04em] text-fg-40">{heading}</h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

type Side = 'live' | 'proposed';

function renderSide(
  side: Side,
  field: RevisionField,
  live: ProjectEdit,
  proposed: ProjectEdit,
  categories: readonly Category[] | null,
  locale: Locale,
  copy: RevisionReviewCopy,
): ReactNode {
  switch (field) {
    case 'title':
      return <TextSide side={side} before={live.title} after={proposed.title} copy={copy} />;
    case 'blurb':
      return <TextSide side={side} before={live.blurb} after={proposed.blurb} copy={copy} />;
    case 'risks':
      return <TextSide side={side} before={live.risks} after={proposed.risks} copy={copy} />;
    case 'category':
      return <CategorySide side={side} live={live} proposed={proposed} categories={categories} copy={copy} />;
    case 'coverImage':
      return <CoverSide side={side} edit={side === 'live' ? live : proposed} copy={copy} />;
    case 'videoMediaId':
      return <VideoSide side={side} edit={side === 'live' ? live : proposed} copy={copy} />;
    case 'story':
      return <StorySide side={side} live={live} proposed={proposed} locale={locale} copy={copy} />;
    case 'countries':
      return <CountriesSide side={side} live={live} proposed={proposed} locale={locale} copy={copy} />;
    case 'rewards':
      return null;
  }
}

/** The spoken marker for a changed span. Hidden from sight: the strike and the underline are the visible one. */
export function Marker({ kind, copy }: { readonly kind: DiffKind; readonly copy: RevisionReviewCopy }) {
  if (kind === 'same') return null;
  return <span className="sr-only">{kind === 'removed' ? copy.removed : copy.added} </span>;
}

export function Span({ part, copy }: { readonly part: DiffPart<string>; readonly copy: RevisionReviewCopy }) {
  if (part.kind === 'same') return <>{part.value}</>;

  const Tag = part.kind === 'removed' ? 'del' : 'ins';
  return (
    <Tag className={`rounded-sm ${part.kind === 'removed' ? REMOVED_CLASS : ADDED_CLASS}`}>
      <Marker kind={part.kind} copy={copy} />
      {part.value}
    </Tag>
  );
}

export function TextSide({
  side,
  before,
  after,
  copy,
}: {
  readonly side: Side;
  readonly before: string | undefined;
  readonly after: string | undefined;
  readonly copy: RevisionReviewCopy;
}) {
  const own = side === 'live' ? before : after;
  if (own === undefined || own === '') return <p className="text-sm text-fg-40">{copy.empty}</p>;

  const sides = diffText(before ?? '', after ?? '');
  const parts = side === 'live' ? sides.live : sides.proposed;

  return (
    <p className="max-w-[68ch] text-sm leading-relaxed wrap-anywhere whitespace-pre-line text-fg-80">
      {parts.map((part, index) => (
        <Span key={index} part={part} copy={copy} />
      ))}
    </p>
  );
}

function categoryLabel(edit: ProjectEdit, categories: readonly Category[] | null): string | null {
  if (edit.categoryId === undefined) return null;

  const category = categories?.find((candidate) => candidate.id === edit.categoryId);
  const subcategory = category?.subcategories.find((candidate) => candidate.id === edit.subcategoryId);
  const names = [category?.name ?? edit.categoryId.slice(0, 8)];
  if (edit.subcategoryId !== undefined) names.push(subcategory?.name ?? edit.subcategoryId.slice(0, 8));

  return names.join(' / ');
}

function CategorySide({
  side,
  live,
  proposed,
  categories,
  copy,
}: {
  readonly side: Side;
  readonly live: ProjectEdit;
  readonly proposed: ProjectEdit;
  readonly categories: readonly Category[] | null;
  readonly copy: RevisionReviewCopy;
}) {
  const label = categoryLabel(side === 'live' ? live : proposed, categories);
  if (label === null) return <p className="text-sm text-fg-40">{copy.noCategory}</p>;

  const changed = categoryLabel(live, categories) !== categoryLabel(proposed, categories);
  const kind: DiffKind = !changed ? 'same' : side === 'live' ? 'removed' : 'added';

  return <p className="text-sm text-fg-80">{<Span part={{ kind, value: label }} copy={copy} />}</p>;
}

function PictureFrame({ side, children }: { readonly side: Side; readonly children: ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-lg border-2 ${side === 'live' ? BLOCK_REMOVED : BLOCK_ADDED}`}>
      {children}
    </div>
  );
}

function CoverSide({ side, edit, copy }: { readonly side: Side; readonly edit: ProjectEdit; readonly copy: RevisionReviewCopy }) {
  const cover = edit.coverImage;
  if (cover?.url === undefined) return <p className="text-sm text-fg-40">{copy.noCover}</p>;

  return (
    <PictureFrame side={side}>
      <Marker kind={side === 'live' ? 'removed' : 'added'} copy={copy} />
      <Image
        src={cover.url}
        alt={fillPlaceholders(copy.coverAlt, { title: edit.title ?? '' })}
        width={cover.width ?? 1280}
        height={cover.height ?? 720}
        className="h-auto w-full"
        /* Unoptimised for the reason the campaign preview gives: a proposed cover is not public yet. */
        unoptimized
      />
    </PictureFrame>
  );
}

function VideoSide({ side, edit, copy }: { readonly side: Side; readonly edit: ProjectEdit; readonly copy: RevisionReviewCopy }) {
  const video = edit.video;
  if (video?.posterUrl === undefined || video.url === undefined) {
    return <p className="text-sm text-fg-40">{copy.noVideo}</p>;
  }

  return (
    <div>
      <PictureFrame side={side}>
        <Marker kind={side === 'live' ? 'removed' : 'added'} copy={copy} />
        <Image
          src={video.posterUrl}
          alt={fillPlaceholders(copy.videoLabel, { title: edit.title ?? '' })}
          width={video.width ?? 1280}
          height={video.height ?? 720}
          className="h-auto w-full"
          unoptimized
        />
      </PictureFrame>
      <a
        href={video.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block rounded-lg text-sm text-fg-64 underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {copy.openVideo}
      </a>
    </div>
  );
}

function CountriesSide({
  side,
  live,
  proposed,
  locale,
  copy,
}: {
  readonly side: Side;
  readonly live: ProjectEdit;
  readonly proposed: ProjectEdit;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const before = [...(live.countries ?? [])].sort();
  const after = [...(proposed.countries ?? [])].sort();
  const parts = diffSequences(before, after).filter((part) =>
    side === 'live' ? part.kind !== 'added' : part.kind !== 'removed',
  );

  if (parts.length === 0) return <p className="text-sm text-fg-40">{copy.noCountries}</p>;

  const names = regionNames(locale);

  return (
    <ul className="flex list-none flex-wrap gap-2">
      {parts.map((part) => (
        <li key={part.value} className="text-sm text-fg-80">
          <Span part={{ kind: part.kind, value: names?.of(part.value) ?? part.value }} copy={copy} />
        </li>
      ))}
    </ul>
  );
}

function StorySide({
  side,
  live,
  proposed,
  locale,
  copy,
}: {
  readonly side: Side;
  readonly live: ProjectEdit;
  readonly proposed: ProjectEdit;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const before = storyLines(live.story);
  const after = storyLines(proposed.story);

  // A story a newer editor wrote is not guessed at; the campaign preview renders it.
  if (before === null || after === null) {
    return <p className="text-sm text-fg-64">{copy.storyUnreadable}</p>;
  }

  const sides = diffStory(before, after);
  const parts = foldUnchanged(side === 'live' ? sides.live : sides.proposed);

  if (parts.length === 0) return <p className="text-sm text-fg-40">{copy.empty}</p>;

  return (
    <ol className="space-y-2">
      {parts.map((part, index) =>
        'folded' in part ? (
          <li key={`folded-${index}`} className="text-xs text-fg-40">
            {pluralise(locale, copy.unchangedBlocks, part.folded)}
          </li>
        ) : (
          <li key={`${part.value.key}-${index}`}>
            <Block line={part.value} kind={part.kind} copy={copy} />
          </li>
        ),
      )}
    </ol>
  );
}

function Block({ line, kind, copy }: { readonly line: StoryLine; readonly kind: DiffKind; readonly copy: RevisionReviewCopy }) {
  const tint = kind === 'removed' ? BLOCK_REMOVED : kind === 'added' ? BLOCK_ADDED : 'border-fg/8';

  return (
    <div className={`rounded-md border-l-4 px-3 py-2 ${tint}`}>
      <Marker kind={kind} copy={copy} />
      <p className="text-xs font-medium text-fg-40">
        {copy.blocks[line.kind]}
        {line.level !== undefined && ` ${line.level}`}
      </p>
      {line.text !== '' && (
        <p
          className={`mt-1 text-sm wrap-anywhere whitespace-pre-line ${kind === 'removed' ? 'line-through decoration-danger decoration-2' : kind === 'added' ? 'underline decoration-success decoration-2 underline-offset-2' : ''} text-fg-80`}
        >
          {line.text}
        </p>
      )}
      {line.items !== undefined && (
        <ul className="mt-1 list-disc pl-5 text-sm text-fg-80">
          {line.items.map((item, index) => (
            <li key={index} className="wrap-anywhere">
              {item}
            </li>
          ))}
        </ul>
      )}
      {line.image !== undefined && (
        <Image
          src={line.image.url}
          alt={line.image.alt}
          width={line.image.width}
          height={line.image.height}
          className="mt-2 h-auto max-h-64 w-auto max-w-full rounded-md"
          unoptimized
        />
      )}
      {line.video !== undefined && (
        <Image
          src={line.video.posterUrl}
          alt=""
          width={line.video.width}
          height={line.video.height}
          className="mt-2 h-auto max-h-64 w-auto max-w-full rounded-md"
          unoptimized
        />
      )}
    </div>
  );
}
