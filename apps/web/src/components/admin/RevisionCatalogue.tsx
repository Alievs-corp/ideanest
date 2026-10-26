import Image from 'next/image';
import type { ReactNode } from 'react';
import { Tag } from '@ideanest/ui';
import type { DiffKind } from '../../lib/admin/revision-diff';
import type {
  RevisionItem,
  RevisionItemField,
  RevisionItemWriting,
  RevisionRewardChange,
  RevisionZone,
  RevisionZones,
} from '../../lib/admin/revisions';
import type { RevisionReviewCopy, RevisionZoneChange } from '../../lib/i18n/admin/revision-copy';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { BLOCK_ADDED, BLOCK_REMOVED, CountryList, Marker, Pane, Span, TextSide, type Side } from './RevisionComparison';
import { ChangeIcon, frame } from './RevisionRewards';

/**
 * The items and shipping zones an edit to a launched campaign changes — issue #589, after #587.
 *
 * <h2>The same reading as the reward tiers</h2>
 *
 * An item is a card named by its live name, the one the moderator finds on the campaign, with a
 * row per field the service names, live beside proposed. A zone is matched with its live self
 * by identifier, so a renamed zone is one card that says "Renamed" and not a zone that goes and
 * another that comes. What happens to a zone is a tag with an icon and a word, and a new or a
 * removed zone is a whole block with the tint and the spoken marker a new or a removed tier has.
 *
 * <h2>Only what changed</h2>
 *
 * The service sends the whole proposed set of zones; a zone in it that is the same as the live
 * one is not drawn, because the review is of the edit.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §8 forbids animation in long content.
 */

/** The order an item's fields are read in on the creator's own editor. */
const ITEM_FIELDS: readonly RevisionItemField[] = ['name', 'description', 'imageUrl', 'weightGrams', 'isDigital'];

const NO_WRITING: RevisionItemWriting = {};

const ZONE_VARIANT = {
  added: 'success',
  removed: 'danger',
  renamed: 'warning',
  countries: 'warning',
} as const;

/** A zone's change drawn with the icon its tier counterpart has. */
const ZONE_ICON: Readonly<Record<RevisionZoneChange, RevisionRewardChange>> = {
  added: 'created',
  removed: 'deleted',
  renamed: 'changed',
  countries: 'changed',
};

export interface RevisionItemsProps {
  readonly items: readonly RevisionItem[];
  readonly copy: RevisionReviewCopy;
}

export function RevisionItems({ items, copy }: RevisionItemsProps) {
  return (
    <section aria-labelledby="revision-items-heading" className="mt-8">
      <h3 id="revision-items-heading" className="text-base font-medium tracking-[-0.02em] text-fg">
        {copy.fields.items}
      </h3>
      <p className="mt-1 max-w-[62ch] text-sm text-fg-64">{copy.items.intro}</p>
      <ul className="mt-4 list-none space-y-6">
        {items.map((item) => (
          <li key={item.id}>
            <Item item={item} copy={copy} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The live name first: a renamed item is looked for on the campaign under the name it has there. */
function itemName(item: RevisionItem, copy: RevisionReviewCopy): string {
  const name = item.live?.name ?? item.proposed?.name;
  return name == null || name === '' ? copy.items.untitled : name;
}

function Item({ item, copy }: { readonly item: RevisionItem; readonly copy: RevisionReviewCopy }) {
  const ic = copy.items;
  const name = itemName(item, copy);
  const fields = ITEM_FIELDS.filter((field) => item.changedFields.includes(field));

  return (
    <article
      aria-label={fillPlaceholders(ic.itemLabel, { name })}
      className="rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5"
    >
      <h4 className="min-w-0 text-base font-medium tracking-[-0.02em] wrap-anywhere text-fg">{name}</h4>
      <div className="mt-4 space-y-5">
        {fields.map((field) => (
          <section key={field} aria-label={`${name}: ${ic.fields[field]}`}>
            <h5 className="text-sm font-medium text-fg">{ic.fields[field]}</h5>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              {(['live', 'proposed'] as const).map((side) => (
                <Pane key={side} heading={side === 'live' ? copy.liveHeading : copy.proposedHeading} field={`${name}: ${ic.fields[field]}`}>
                  <ItemValue
                    field={field}
                    side={side}
                    live={item.live ?? NO_WRITING}
                    proposed={item.proposed ?? NO_WRITING}
                    name={name}
                    copy={copy}
                  />
                </Pane>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function ItemValue({
  field,
  side,
  live,
  proposed,
  name,
  copy,
}: {
  readonly field: RevisionItemField;
  readonly side: Side;
  readonly live: RevisionItemWriting;
  readonly proposed: RevisionItemWriting;
  readonly name: string;
  readonly copy: RevisionReviewCopy;
}) {
  switch (field) {
    case 'name':
      return <TextSide side={side} before={live.name ?? undefined} after={proposed.name ?? undefined} copy={copy} />;
    case 'description':
      return <TextSide side={side} before={live.description ?? undefined} after={proposed.description ?? undefined} copy={copy} />;
    case 'imageUrl':
      return <ItemPicture side={side} live={live} proposed={proposed} name={name} copy={copy} />;
    default: {
      const before = itemScalar(field, live, copy);
      const after = itemScalar(field, proposed, copy);
      const kind: DiffKind = before === after ? 'same' : side === 'live' ? 'removed' : 'added';

      return (
        <p className="text-sm text-fg-80">
          <Span part={{ kind, value: side === 'live' ? before : after }} copy={copy} />
        </p>
      );
    }
  }
}

function itemScalar(field: 'weightGrams' | 'isDigital', writing: RevisionItemWriting, copy: RevisionReviewCopy): string {
  if (field === 'isDigital') return writing.isDigital === true ? copy.rewards.yes : copy.rewards.no;
  return writing.weightGrams == null
    ? copy.items.noWeight
    : fillPlaceholders(copy.items.weight, { grams: String(writing.weightGrams) });
}

/**
 * An item's picture is an address the creator typed, not an upload, so the address is shown as
 * well as the picture, and only an `https:` one is drawn: the console's `img-src` refuses any
 * other, and a picture that cannot load would read as "no change".
 */
function ItemPicture({
  side,
  live,
  proposed,
  name,
  copy,
}: {
  readonly side: Side;
  readonly live: RevisionItemWriting;
  readonly proposed: RevisionItemWriting;
  readonly name: string;
  readonly copy: RevisionReviewCopy;
}) {
  const url = side === 'live' ? live.imageUrl : proposed.imageUrl;
  if (url == null || url === '') return <p className="text-sm text-fg-40">{copy.rewards.noImage}</p>;

  const kind: DiffKind = live.imageUrl === proposed.imageUrl ? 'same' : side === 'live' ? 'removed' : 'added';

  return (
    <div>
      {/^https:\/\//i.test(url) && (
        <div className={`overflow-hidden rounded-lg border-2 ${frame(kind)}`}>
          <Marker kind={kind} copy={copy} />
          <Image
            src={url}
            alt={fillPlaceholders(copy.items.imageAlt, { name })}
            width={640}
            height={640}
            className="h-auto w-full"
            referrerPolicy="no-referrer"
            /* Unoptimised: the address is the creator's own, on no host the optimiser is allowed to fetch. */
            unoptimized
          />
        </div>
      )}
      <p className="mt-2 text-xs text-fg-64 wrap-anywhere">
        <Span part={{ kind, value: url }} copy={copy} />
      </p>
    </div>
  );
}

/** What the revision does to one zone, matched with its live self by identifier. */
export interface ZoneDiff {
  readonly id: string;
  readonly changes: readonly RevisionZoneChange[];
  readonly live: RevisionZone | null;
  readonly proposed: RevisionZone | null;
}

function sameCountries(a: RevisionZone['countryCodes'], b: RevisionZone['countryCodes']): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

/** The zones the revision adds, changes or removes, in its proposed order and the removed ones after. */
export function zoneDiffs(zones: RevisionZones): readonly ZoneDiff[] {
  const live = new Map(zones.live.map((zone) => [zone.id, zone]));
  const kept = new Set(zones.proposed.map((zone) => zone.id));
  const diffs: ZoneDiff[] = [];

  for (const zone of zones.proposed) {
    const was = live.get(zone.id);
    if (was === undefined) {
      diffs.push({ id: zone.id, changes: ['added'], live: null, proposed: zone });
      continue;
    }

    const changes: RevisionZoneChange[] = [];
    if ((was.name ?? '') !== (zone.name ?? '')) changes.push('renamed');
    if (!sameCountries(was.countryCodes, zone.countryCodes)) changes.push('countries');
    if (changes.length > 0) diffs.push({ id: zone.id, changes, live: was, proposed: zone });
  }

  for (const zone of zones.live) {
    if (!kept.has(zone.id)) diffs.push({ id: zone.id, changes: ['removed'], live: zone, proposed: null });
  }

  return diffs;
}

export interface RevisionShippingZonesProps {
  readonly zones: RevisionZones;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}

export function RevisionShippingZones({ zones, locale, copy }: RevisionShippingZonesProps) {
  const diffs = zoneDiffs(zones);

  return (
    <section aria-labelledby="revision-zones-heading" className="mt-8">
      <h3 id="revision-zones-heading" className="text-base font-medium tracking-[-0.02em] text-fg">
        {copy.fields.shippingZones}
      </h3>
      <p className="mt-1 max-w-[62ch] text-sm text-fg-64">{copy.shippingZones.intro}</p>
      {diffs.length === 0 ? (
        <p className="mt-4 text-sm text-fg-64">{copy.shippingZones.unchanged}</p>
      ) : (
        <ul className="mt-4 list-none space-y-6">
          {diffs.map((diff) => (
            <li key={diff.id}>
              <Zone diff={diff} locale={locale} copy={copy} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function zoneName(zone: RevisionZone | null, copy: RevisionReviewCopy): string {
  const name = zone?.name;
  return name == null || name === '' ? copy.shippingZones.untitled : name;
}

function Zone({
  diff,
  locale,
  copy,
}: {
  readonly diff: ZoneDiff;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const zc = copy.shippingZones;
  const name = zoneName(diff.live ?? diff.proposed, copy);
  const renamed = diff.changes.includes('renamed');
  const countries = diff.changes.includes('countries');

  return (
    <article
      aria-label={fillPlaceholders(zc.zoneLabel, { name })}
      className="rounded-xl border border-fg/8 bg-surface-1 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="min-w-0 text-base font-medium tracking-[-0.02em] wrap-anywhere text-fg">{name}</h4>
        <ul className="flex list-none flex-wrap items-center gap-2" aria-label={copy.rewards.changesLabel}>
          {diff.changes.map((change) => (
            <li key={change}>
              <Tag variant={ZONE_VARIANT[change]}>
                <ChangeIcon change={ZONE_ICON[change]} />
                {zc.changes[change]}
              </Tag>
            </li>
          ))}
        </ul>
      </div>

      {diff.proposed !== null && diff.live === null && (
        <WholeZone zone={diff.proposed} kind="added" note={zc.addedNote} locale={locale} copy={copy} />
      )}
      {diff.live !== null && diff.proposed === null && (
        <WholeZone zone={diff.live} kind="removed" note={zc.removedNote} locale={locale} copy={copy} />
      )}
      {diff.live !== null && diff.proposed !== null && (
        <div className="mt-4 space-y-5">
          {renamed && (
            <ZoneRow name={name} label={zc.name} copy={copy}>
              {(side) => (
                <TextSide side={side} before={diff.live?.name ?? undefined} after={diff.proposed?.name ?? undefined} copy={copy} />
              )}
            </ZoneRow>
          )}
          {countries && (
            <ZoneRow name={name} label={zc.countries} copy={copy}>
              {(side) => (
                <CountryList
                  side={side}
                  before={diff.live?.countryCodes}
                  after={diff.proposed?.countryCodes}
                  locale={locale}
                  copy={copy}
                />
              )}
            </ZoneRow>
          )}
        </div>
      )}
    </article>
  );
}

function ZoneRow({
  name,
  label,
  copy,
  children,
}: {
  readonly name: string;
  readonly label: string;
  readonly copy: RevisionReviewCopy;
  readonly children: (side: Side) => ReactNode;
}) {
  return (
    <section aria-label={`${name}: ${label}`}>
      <h5 className="text-sm font-medium text-fg">{label}</h5>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        {(['live', 'proposed'] as const).map((side) => (
          <Pane key={side} heading={side === 'live' ? copy.liveHeading : copy.proposedHeading} field={`${name}: ${label}`}>
            {children(side)}
          </Pane>
        ))}
      </div>
    </section>
  );
}

/** A zone that arrives or goes, drawn whole: it has no other side to be compared with. */
function WholeZone({
  zone,
  kind,
  note,
  locale,
  copy,
}: {
  readonly zone: RevisionZone;
  readonly kind: 'added' | 'removed';
  readonly note: string;
  readonly locale: Locale;
  readonly copy: RevisionReviewCopy;
}) {
  const zc = copy.shippingZones;

  return (
    <div className={`mt-4 rounded-lg border-l-4 px-4 py-3 ${kind === 'added' ? BLOCK_ADDED : BLOCK_REMOVED}`}>
      <Marker kind={kind} copy={copy} />
      <p className="text-sm font-medium text-fg">{note}</p>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="text-xs font-medium text-fg-40">{zc.name}</dt>
          <dd className="mt-1 text-sm text-fg-80 wrap-anywhere">{zoneName(zone, copy)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-fg-40">{zc.countries}</dt>
          <dd className="mt-1">
            <CountryList side="proposed" before={zone.countryCodes} after={zone.countryCodes} locale={locale} copy={copy} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
