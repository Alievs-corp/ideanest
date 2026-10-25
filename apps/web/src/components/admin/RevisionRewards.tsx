import Image from 'next/image';
import { Tag } from '@ideanest/ui';
import { formatMoney } from '../../lib/money';
import { diffSequences, type DiffKind } from '../../lib/admin/revision-diff';
import type {
  RevisionReward,
  RevisionRewardChange,
  RevisionRewardField,
  RevisionRewardWriting,
} from '../../lib/admin/revisions';
import type { RevisionReviewCopy } from '../../lib/i18n/admin/revision-copy';
import { regionNames } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatDate, formatExactTime } from '../../lib/time';
import { BLOCK_ADDED, BLOCK_REMOVED, Marker, Pane, Span, TextSide } from './RevisionComparison';

/**
 * The reward tiers an edit creates, removes, moves or changes — issue #569, part of epic #557.
 *
 * <h2>Not colour alone</h2>
 *
 * What happens to a tier is a tag with an icon and a word. A new tier and a tier that goes are
 * whole blocks with the same border tint as a changed picture plus a spoken "Added:" or
 * "Removed:"; a changed tier is a row per changed field, live beside proposed, with the same
 * strike and underline as the campaign's own text.
 *
 * <h2>Only what the service names</h2>
 *
 * A changed tier draws the fields its `changedFields` lists and nothing else, and a price is
 * shown once on the card because an edit never changes it.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in long content.
 */
export interface RevisionRewardsProps {
  readonly rewards: readonly RevisionReward[];
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}

/** The order a tier's fields are read in on the creator's own editor. */
const FIELD_ORDER: readonly RevisionRewardField[] = [
  'title',
  'description',
  'imageMediaId',
  'videoMediaId',
  'estimatedDelivery',
  'limitQuantity',
  'shippingType',
  'isEarlyBird',
  'isFeatured',
  'isSecret',
  'isAddon',
  'availableFrom',
  'availableUntil',
  'items',
  'shippingRules',
  'shippingZoneRates',
];

const CHANGE_ORDER: readonly RevisionRewardChange[] = ['created', 'deleted', 'changed', 'reordered'];

const CHANGE_VARIANT = {
  created: 'success',
  deleted: 'danger',
  changed: 'warning',
  reordered: 'default',
} as const;

const NO_WRITING: RevisionRewardWriting = {};

type Side = 'live' | 'proposed';

export function RevisionRewards({ rewards, locale, copy }: RevisionRewardsProps) {
  const rc = copy.rewards;

  return (
    <section aria-labelledby="revision-rewards-heading" className="mt-8">
      <h3 id="revision-rewards-heading" className="text-base font-medium tracking-[-0.02em] text-fg">
        {copy.fields.rewards}
      </h3>
      <p className="mt-1 max-w-[62ch] text-sm text-fg-64">{rc.intro}</p>
      <ul className="mt-4 list-none space-y-6">
        {rewards.map((reward) => (
          <li key={reward.id}>
            <Tier reward={reward} locale={locale} copy={copy} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function titleOf(reward: RevisionReward, copy: RevisionReviewCopy): string {
  const title = reward.proposed?.title ?? reward.live?.title;
  return title === undefined || title === '' ? copy.rewards.untitled : title;
}

function Tier({
  reward,
  locale,
  copy,
}: {
  readonly reward: RevisionReward;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const rc = copy.rewards;
  const title = titleOf(reward, copy);
  const changes = CHANGE_ORDER.filter((change) => reward.changes.includes(change));
  const created = changes.includes('created');
  const deleted = changes.includes('deleted');
  const changed = changes.includes('changed');
  const fields = FIELD_ORDER.filter((field) => reward.changedFields.includes(field));

  return (
    <article
      aria-label={fillPlaceholders(rc.tierLabel, { title })}
      className="rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="min-w-0 text-base font-medium tracking-[-0.02em] wrap-anywhere text-fg">{title}</h4>
        <ul className="flex list-none flex-wrap items-center gap-2" aria-label={rc.changesLabel}>
          {changes.map((change) => (
            <li key={change}>
              <Tag variant={CHANGE_VARIANT[change]}>
                <ChangeIcon change={change} />
                {rc.changes[change]}
              </Tag>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-2 text-sm text-fg-64">
        {fillPlaceholders(rc.price, { price: formatMoney(reward.price) })}
        {changed && ` · ${rc.priceFrozen}`}
      </p>
      <Position reward={reward} copy={copy} />

      {created && reward.proposed != null && (
        <WholeTier writing={reward.proposed} kind="added" note={rc.createdNote} reward={reward} locale={locale} copy={copy} />
      )}
      {deleted && reward.live != null && (
        <WholeTier writing={reward.live} kind="removed" note={rc.deletedNote} reward={reward} locale={locale} copy={copy} />
      )}
      {changed && (
        <div className="mt-4 space-y-5">
          {fields.map((field) => (
            <section key={field} aria-label={`${title}: ${rc.fields[field]}`}>
              <h5 className="text-sm font-medium text-fg">{rc.fields[field]}</h5>
              <div className="mt-2 grid gap-4 md:grid-cols-2">
                {(['live', 'proposed'] as const).map((side) => (
                  <Pane key={side} heading={side === 'live' ? copy.liveHeading : copy.proposedHeading} field={`${title}: ${rc.fields[field]}`}>
                    <FieldValue
                      field={field}
                      side={side}
                      live={reward.live ?? NO_WRITING}
                      proposed={reward.proposed ?? NO_WRITING}
                      reward={reward}
                      locale={locale}
                      copy={copy}
                    />
                  </Pane>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {!created && !deleted && !changed && <p className="mt-4 text-sm text-fg-64">{rc.movedOnly}</p>}
    </article>
  );
}

function Position({ reward, copy }: { readonly reward: RevisionReward; readonly copy: RevisionReviewCopy }) {
  const rc = copy.rewards;
  const live = reward.livePosition;
  const proposed = reward.proposedPosition;

  let text: string | null = null;
  if (live != null && proposed != null) {
    text = fillPlaceholders(rc.placeBoth, { live: String(live + 1), proposed: String(proposed + 1) });
  } else if (live != null) {
    text = fillPlaceholders(rc.placeLive, { place: String(live + 1) });
  } else if (proposed != null) {
    text = fillPlaceholders(rc.placeProposed, { place: String(proposed + 1) });
  }

  return text === null ? null : <p className="mt-1 text-sm text-fg-64">{text}</p>;
}

function ChangeIcon({ change }: { readonly change: RevisionRewardChange }) {
  const path = {
    created: 'M8 3v10M3 8h10',
    deleted: 'M3 8h10',
    changed: 'M3 13l1-3 7-7 2 2-7 7-3 1z',
    reordered: 'M5 13V3m0 0L2 6m3-3l3 3M11 3v10m0 0l3-3m-3 3l-3-3',
  }[change];

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/** A tier that arrives or goes, drawn whole: it has no other side to be compared with. */
function WholeTier({
  writing,
  kind,
  note,
  reward,
  locale,
  copy,
}: {
  readonly writing: RevisionRewardWriting;
  readonly kind: 'added' | 'removed';
  readonly note: string;
  readonly reward: RevisionReward;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const rc = copy.rewards;

  return (
    <div className={`mt-4 rounded-lg border-l-4 px-4 py-3 ${kind === 'added' ? BLOCK_ADDED : BLOCK_REMOVED}`}>
      <Marker kind={kind} copy={copy} />
      <p className="text-sm font-medium text-fg">{note}</p>
      <dl className="mt-3 space-y-3">
        {FIELD_ORDER.map((field) => (
          <div key={field}>
            <dt className="text-xs font-medium text-fg-40">{rc.fields[field]}</dt>
            <dd className="mt-1">
              <FieldValue
                field={field}
                side="proposed"
                live={writing}
                proposed={writing}
                reward={reward}
                whole
                locale={locale}
                copy={copy}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FieldValue({
  field,
  side,
  live,
  proposed,
  reward,
  whole = false,
  locale,
  copy,
}: {
  readonly field: RevisionRewardField;
  readonly side: Side;
  readonly live: RevisionRewardWriting;
  readonly proposed: RevisionRewardWriting;
  readonly reward: RevisionReward;
  readonly whole?: boolean;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const rc = copy.rewards;
  const own = side === 'live' ? live : proposed;

  switch (field) {
    case 'title':
      return <TextSide side={side} before={live.title} after={proposed.title} copy={copy} />;
    case 'description':
      return <TextSide side={side} before={live.description} after={proposed.description} copy={copy} />;
    case 'imageMediaId':
      return <PictureValue side={side} live={live} proposed={proposed} reward={reward} copy={copy} />;
    case 'videoMediaId':
      return <ClipValue side={side} live={live} proposed={proposed} reward={reward} copy={copy} />;
    case 'items':
      return (
        <LinesValue
          side={side}
          before={itemLines(live, copy)}
          after={itemLines(proposed, copy)}
          empty={rc.noItems}
          copy={copy}
        />
      );
    case 'shippingRules':
      return (
        <LinesValue
          side={side}
          before={ruleLines(live, reward, locale, copy)}
          after={ruleLines(proposed, reward, locale, copy)}
          empty={rc.noRates}
          copy={copy}
        />
      );
    case 'shippingZoneRates':
      return (
        <LinesValue
          side={side}
          before={zoneLines(live, reward, copy)}
          after={zoneLines(proposed, reward, copy)}
          empty={rc.noRates}
          copy={copy}
        />
      );
    default: {
      const before = scalar(field, live, locale, copy);
      const after = scalar(field, proposed, locale, copy);
      const kind: DiffKind = before === after ? 'same' : side === 'live' ? 'removed' : 'added';

      return (
        <>
          <p className="text-sm text-fg-80">
            <Span part={{ kind, value: side === 'live' ? before : after }} copy={copy} />
          </p>
          {field === 'isSecret' && side === 'proposed' && !whole && before === after && own.isSecret === true && (
            <p className="mt-1 text-xs text-fg-64">{rc.secretLinkReplaced}</p>
          )}
        </>
      );
    }
  }
}

function scalar(
  field: RevisionRewardField,
  writing: RevisionRewardWriting,
  locale: Locale,
  copy: RevisionReviewCopy,
): string {
  const rc = copy.rewards;
  const yesNo = (value: boolean | undefined) => (value === true ? rc.yes : rc.no);

  switch (field) {
    case 'estimatedDelivery':
      return writing.estimatedDelivery == null ? rc.none : formatDate(`${writing.estimatedDelivery}T12:00:00Z`, locale);
    case 'limitQuantity':
      return writing.limitQuantity == null ? rc.unlimited : String(writing.limitQuantity);
    case 'shippingType':
      return writing.shippingType == null ? rc.none : (rc.shippingTypes[writing.shippingType] ?? writing.shippingType);
    case 'isEarlyBird':
      return yesNo(writing.isEarlyBird);
    case 'isFeatured':
      return yesNo(writing.isFeatured);
    case 'isSecret':
      return yesNo(writing.isSecret);
    case 'isAddon':
      return yesNo(writing.isAddon);
    case 'availableFrom':
      return writing.availableFrom == null ? rc.none : formatExactTime(writing.availableFrom, locale);
    case 'availableUntil':
      return writing.availableUntil == null ? rc.none : formatExactTime(writing.availableUntil, locale);
    default:
      return '';
  }
}

function itemLines(writing: RevisionRewardWriting, copy: RevisionReviewCopy): readonly string[] {
  return (writing.items ?? []).map((item) =>
    fillPlaceholders(copy.rewards.itemLine, {
      name: item.name ?? copy.rewards.itemGone,
      quantity: String(item.quantity ?? 0),
    }),
  );
}

function rateText(
  rate: { readonly amount?: string; readonly additionalItemAmount?: string; readonly perKilogramAmount?: string },
  reward: RevisionReward,
  copy: RevisionReviewCopy,
): string {
  const money = (amount: string | undefined) => formatMoney({ amount: amount ?? '0', currency: reward.price.currency });

  return fillPlaceholders(copy.rewards.rateLine, {
    amount: money(rate.amount),
    additional: money(rate.additionalItemAmount),
    perKilogram: money(rate.perKilogramAmount),
  });
}

function ruleLines(
  writing: RevisionRewardWriting,
  reward: RevisionReward,
  locale: Locale,
  copy: RevisionReviewCopy,
): readonly string[] {
  const names = regionNames(locale);

  return (writing.shippingRules ?? []).map((rule) => {
    const code = rule.countryCode ?? '';
    return `${names?.of(code) ?? code}: ${rateText(rule, reward, copy)}`;
  });
}

function zoneLines(writing: RevisionRewardWriting, reward: RevisionReward, copy: RevisionReviewCopy): readonly string[] {
  return (writing.shippingZoneRates ?? []).map(
    (rate) => `${rate.zoneName ?? copy.rewards.zoneGone}: ${rateText(rate, reward, copy)}`,
  );
}

function LinesValue({
  side,
  before,
  after,
  empty,
  copy,
}: {
  readonly side: Side;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly empty: string;
  readonly copy: RevisionReviewCopy;
}) {
  const own = side === 'live' ? before : after;
  if (own.length === 0) return <p className="text-sm text-fg-40">{empty}</p>;

  const parts = diffSequences(before, after).filter((part) =>
    side === 'live' ? part.kind !== 'added' : part.kind !== 'removed',
  );

  return (
    <ul className="list-none space-y-1">
      {parts.map((part, index) => (
        <li key={index} className="text-sm text-fg-80 wrap-anywhere">
          <Span part={part} copy={copy} />
        </li>
      ))}
    </ul>
  );
}

function frame(kind: DiffKind): string {
  return kind === 'removed' ? BLOCK_REMOVED : kind === 'added' ? BLOCK_ADDED : 'border-fg/8';
}

function PictureValue({
  side,
  live,
  proposed,
  reward,
  copy,
}: {
  readonly side: Side;
  readonly live: RevisionRewardWriting;
  readonly proposed: RevisionRewardWriting;
  readonly reward: RevisionReward;
  readonly copy: RevisionReviewCopy;
}) {
  const image = (side === 'live' ? live : proposed).image;
  if (image?.url === undefined) return <p className="text-sm text-fg-40">{copy.rewards.noImage}</p>;

  const changed = live.image?.mediaId !== proposed.image?.mediaId;
  const kind: DiffKind = !changed ? 'same' : side === 'live' ? 'removed' : 'added';

  return (
    <div className={`overflow-hidden rounded-lg border-2 ${frame(kind)}`}>
      <Marker kind={kind} copy={copy} />
      <Image
        src={image.url}
        alt={fillPlaceholders(copy.rewards.imageAlt, { title: titleOf(reward, copy) })}
        width={image.width ?? 1280}
        height={image.height ?? 720}
        className="h-auto w-full"
        /* Unoptimised for the reason the campaign comparison gives: a proposed picture is not public yet. */
        unoptimized
      />
    </div>
  );
}

function ClipValue({
  side,
  live,
  proposed,
  reward,
  copy,
}: {
  readonly side: Side;
  readonly live: RevisionRewardWriting;
  readonly proposed: RevisionRewardWriting;
  readonly reward: RevisionReward;
  readonly copy: RevisionReviewCopy;
}) {
  const video = (side === 'live' ? live : proposed).video;
  if (video?.posterUrl === undefined || video.url === undefined) {
    return <p className="text-sm text-fg-40">{copy.noVideo}</p>;
  }

  const changed = live.video?.mediaId !== proposed.video?.mediaId;
  const kind: DiffKind = !changed ? 'same' : side === 'live' ? 'removed' : 'added';

  return (
    <div>
      <div className={`overflow-hidden rounded-lg border-2 ${frame(kind)}`}>
        <Marker kind={kind} copy={copy} />
        <Image
          src={video.posterUrl}
          alt={fillPlaceholders(copy.videoLabel, { title: titleOf(reward, copy) })}
          width={video.width ?? 1280}
          height={video.height ?? 720}
          className="h-auto w-full"
          unoptimized
        />
      </div>
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
