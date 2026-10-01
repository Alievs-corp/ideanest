'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Checkbox, Field, Pill, TextInput } from '@ideanest/ui';
import { countOf, type DiscoveryFacets, type ValueCount } from '../../lib/discovery/api';
import {
  boundsAreOrdered,
  isValidBound,
  toggleAmountBand,
  toggleCategory,
  toggleCompletion,
  toggleStatus,
  toggleSubcategory,
  toggleTag,
  withAmountRange,
  type DiscoveryFilters,
} from '@ideanest/discovery/filters';
import { AMOUNT_BANDS, COMPLETION_BANDS, STATUSES, labelOf } from '@ideanest/discovery/vocabulary';
import type { FeedCopy } from '../../lib/i18n/feed-copy';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * The filter panel: every filter §4.3 lists that `GET /v1/discover` can
 * actually apply.
 *
 * WHAT IS NOT HERE, AND WHY. Location (country, city, proximity),
 * `showOnly=saved`, `showOnly=recommended` and `showOnly=featured` are
 * representable on the service's query object and refused by every
 * implementation of it — there is no location column, no saved-projects table,
 * no ranking, and no curation yet, and each refusal names the issue that owns
 * it (#47, #44, #48). Rendering a control that is answered with
 * `400 DISCOVERY_OPTION_UNSUPPORTED` would be an interface that breaks the
 * first time anybody uses it, so they are absent rather than disabled: a
 * disabled control still says "this exists and you may not have it", which is
 * a different and equally wrong claim. Free-text search is #43/#46 and is not a
 * filter in this rail.
 *
 * A ZERO IS SHOWN, NEVER HIDDEN. The fixed vocabularies answer for all of their
 * values including the empty ones, and the rail renders all of them: a control
 * that disappears when its count reaches zero is a control that moves under the
 * reader's cursor, and a filter whose options come and go is a filter people
 * stop trusting. An empty option is DISABLED and reads "None" rather than "0",
 * so the unavailability is a word and not only a dimming.
 *
 * A COUNT EXCLUDES ITS OWN DIMENSION. That is the service's doing, and it is
 * what makes the panel usable: counted under the category already chosen, every
 * other category would read zero and the only move left would be to clear the
 * filter.
 *
 * KEYBOARD AND STRUCTURE. Real `<fieldset>`/`<legend>` per dimension and real
 * `<input type="checkbox">` throughout, so the rail is one landmark containing
 * named groups rather than a soup of divs — a screen-reader user can jump
 * between the groups, and everything here is reachable and operable with Tab
 * and Space. Nothing is a click handler on a `<div>`.
 *
 * MOTION: none. Discovery's budget is the skeleton-to-content crossfade and
 * nothing else (docs/motion-system.md §5); a panel that animates while somebody
 * is ticking boxes is a panel that is slower to use.
 */

interface FacetCheckboxProps {
  label: string;
  /** What an empty option reads, so unavailability is a word and not only a dimming. */
  none: string;
  /** Null when the panel has not loaded. An unknown count is never shown as zero. */
  count: number | null;
  checked: boolean;
  onToggle: () => void;
}

function FacetCheckbox({ label, none, count, checked, onToggle }: FacetCheckboxProps) {
  /*
   * An option is only unavailable if it is BOTH empty and unchosen. A ticked
   * value that now counts zero must stay operable, or the reader is left with a
   * filter they cannot remove from the control that applied it.
   */
  const unavailable = count === 0 && !checked;

  return (
    <li className="flex items-center justify-between gap-3">
      <Checkbox checked={checked} disabled={unavailable} onChange={onToggle} label={label} />
      <span className="shrink-0 text-xs text-white/40 tabular-nums">
        {count === null ? '' : count === 0 ? none : count}
      </span>
    </li>
  );
}

interface GroupProps {
  legend: string;
  children: ReactNode;
}

function Group({ legend, children }: GroupProps) {
  return (
    <fieldset className="border-t border-white/8 pt-5">
      <legend className="mb-3 text-sm font-medium text-white">{legend}</legend>
      {children}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
 * The custom money range
 * ---------------------------------------------------------------------- */

interface RangeFieldsProps {
  dimension: 'goal' | 'raised';
  legend: string;
  copy: FeedCopy;
  /** For `toLocaleLowerCase` — see `FilterRailProps`. */
  locale: Locale;
  min: string | null;
  max: string | null;
  onApply: (range: { min: string | null; max: string | null }) => void;
}

/**
 * Two boxes and an apply control, deliberately not a live filter.
 *
 * A range applied per keystroke sends a request for "2", "25", "250" and "2500"
 * on the way to 25,000 — four feeds nobody asked for, and the reader watches
 * the results thrash while they are still typing. It also cannot be validated:
 * a minimum above its maximum is only wrong once both have been typed, and the
 * service answers that pair with a 400.
 *
 * The bounds are checked with `decimal.js` before they are applied, because
 * they are money and money never goes near floating point (CLAUDE.md §3).
 */
function RangeFields({ dimension, legend, copy, locale, min, max, onApply }: RangeFieldsProps) {
  const [from, setFrom] = useState(min ?? '');
  const [to, setTo] = useState(max ?? '');
  const [error, setError] = useState<string | null>(null);

  // The URL is the state, so a range removed by its chip has to come back out
  // of these boxes too — otherwise the panel disagrees with the feed.
  useEffect(() => setFrom(min ?? ''), [min]);
  useEffect(() => setTo(max ?? ''), [max]);

  function apply(): void {
    const lower = from.trim() === '' ? null : from.trim();
    const upper = to.trim() === '' ? null : to.trim();

    if (!isValidBound(lower) || !isValidBound(upper)) {
      setError(copy.rangeInvalid);
      return;
    }
    if (!boundsAreOrdered(lower, upper)) {
      setError(copy.rangeUnordered);
      return;
    }

    setError(null);
    onApply({ min: lower, max: upper });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-[13px] text-white/64">{copy.customRange}</p>

      {/*
        The labels name their dimension. Two fields called "Lowest" on one page
        are two controls with the same accessible name, and a screen-reader
        user tabbing into the second has no way to tell which range they are in.
      */}
      <div className="flex gap-3">
        <Field
          label={fillPlaceholders(copy.lowest, { dimension: legend.toLocaleLowerCase(locale) })}
          className="flex-1"
        >
          <TextInput
            inputMode="decimal"
            autoComplete="off"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field
          label={fillPlaceholders(copy.highest, { dimension: legend.toLocaleLowerCase(locale) })}
          className="flex-1"
        >
          <TextInput
            inputMode="decimal"
            autoComplete="off"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
      </div>

      {error !== null && (
        // Announced on insertion rather than only coloured. A red border says
        // nothing to a screen reader (docs/ui-kit.md §7.13).
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <div>
        <Pill
          size="sm"
          variant="ghost"
          onClick={apply}
          aria-label={fillPlaceholders(copy.applyRangeLabel, {
            dimension: legend.toLocaleLowerCase(locale),
          })}
          data-range={dimension}
        >
          {copy.applyRange}
        </Pill>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The rail
 * ---------------------------------------------------------------------- */

export interface FilterRailProps {
  filters: DiscoveryFilters;
  facets: DiscoveryFacets | null;
  onChange: (next: DiscoveryFilters) => void;
  /** Every word this rail draws, resolved by the route — see `lib/i18n/feed-copy.ts`. */
  copy: FeedCopy;
  /**
   * The language, for `toLocaleLowerCase` alone.
   *
   * "Goal amount" becomes "goal amount" inside "Lowest goal amount", and a plain
   * `toLowerCase()` is wrong in Turkish: the capital I lowercases to a dotless ı unless the
   * locale is passed, so "Amount raised" would read with a letter the language does not use
   * there.
   */
  locale: Locale;
}

export function FilterRail({ filters, facets, onChange, copy, locale }: FilterRailProps) {
  const vocabulary = copy.filters;
  /**
   * The count for one value, or null while the panel has not loaded.
   *
   * NULL IS NOT ZERO. Zero is what marks an option the reader cannot use, and
   * showing an unknown count as zero would disable half the rail every time the
   * panel was slow.
   */
  const countFor = (source: readonly ValueCount[] | undefined, value: string): number | null =>
    facets === null ? null : countOf(source, value);

  return (
    <form
      aria-label={copy.railLabel}
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        // Nothing here submits: every control applies on change, and the range
        // has its own button. Enter in a text box must not reload the page.
        event.preventDefault();
      }}
    >
      <Group legend={vocabulary.groups.status}>
        <ul className="flex flex-col gap-2.5">
          {STATUSES.map((status) => (
            <FacetCheckbox
              none={copy.none}
              key={status}
              label={labelOf(vocabulary.status, status)}
              count={countFor(facets?.status, status)}
              checked={filters.statuses.includes(status)}
              onToggle={() => onChange(toggleStatus(filters, status))}
            />
          ))}
        </ul>
      </Group>

      <Group legend={vocabulary.groups.category}>
        <ul className="flex flex-col gap-2.5">
          {(facets?.categories ?? []).map((category) => {
            const chosen = filters.categories.includes(category.slug);
            /*
             * Subcategories appear under a category that is TICKED, or under one
             * whose child is already selected — a link may name a subcategory
             * without its parent, and the two filters are independent
             * server-side. Rendering all hundred at once would be a rail nobody
             * can read; hiding a selected one would be a filter with no visible
             * control.
             */
            const childSelected = category.subcategories.some((sub) =>
              filters.subcategories.includes(sub.slug),
            );

            return (
              <li key={category.slug} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Checkbox
                    checked={chosen}
                    disabled={category.count === 0 && !chosen}
                    onChange={() => onChange(toggleCategory(filters, category.slug))}
                    label={category.name}
                  />
                  <span className="shrink-0 text-xs text-white/40 tabular-nums">
                    {category.count === 0 ? copy.none : category.count}
                  </span>
                </div>

                {(chosen || childSelected) && category.subcategories.length > 0 && (
                  <ul
                    aria-label={fillPlaceholders(copy.subcategoriesOf, {
                      category: category.name,
                    })}
                    className="ml-8 flex flex-col gap-2.5 border-l border-white/8 pl-4"
                  >
                    {category.subcategories.map((subcategory) => (
                      <FacetCheckbox
                        none={copy.none}
                        key={subcategory.slug}
                        label={subcategory.name}
                        count={subcategory.count}
                        checked={filters.subcategories.includes(subcategory.slug)}
                        onToggle={() => onChange(toggleSubcategory(filters, subcategory.slug))}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Group>

      <Group legend={vocabulary.groups.completion}>
        <ul className="flex flex-col gap-2.5">
          {COMPLETION_BANDS.map((band) => (
            <FacetCheckbox
              none={copy.none}
              key={band}
              label={labelOf(vocabulary.completion, band)}
              count={countFor(facets?.completion, band)}
              checked={filters.completion.includes(band)}
              onToggle={() => onChange(toggleCompletion(filters, band))}
            />
          ))}
        </ul>
      </Group>

      <Group legend={vocabulary.groups.goal}>
        <ul className="flex flex-col gap-2.5">
          {AMOUNT_BANDS.map((band) => (
            <FacetCheckbox
              none={copy.none}
              key={band}
              label={labelOf(vocabulary.amount, band)}
              count={countFor(facets?.goalAmount, band)}
              checked={filters.goal.bands.includes(band)}
              onToggle={() => onChange(toggleAmountBand(filters, 'goal', band))}
            />
          ))}
        </ul>
        <RangeFields
          dimension="goal"
          legend={vocabulary.groups.goal}
          copy={copy}
          locale={locale}
          min={filters.goal.min}
          max={filters.goal.max}
          onApply={(range) => onChange(withAmountRange(filters, 'goal', range))}
        />
      </Group>

      <Group legend={vocabulary.groups.raised}>
        <ul className="flex flex-col gap-2.5">
          {AMOUNT_BANDS.map((band) => (
            <FacetCheckbox
              none={copy.none}
              key={band}
              label={labelOf(vocabulary.amount, band)}
              count={countFor(facets?.amountRaised, band)}
              checked={filters.raised.bands.includes(band)}
              onToggle={() => onChange(toggleAmountBand(filters, 'raised', band))}
            />
          ))}
        </ul>
        <RangeFields
          dimension="raised"
          legend={vocabulary.groups.raised}
          copy={copy}
          locale={locale}
          min={filters.raised.min}
          max={filters.raised.max}
          onApply={(range) => onChange(withAmountRange(filters, 'raised', range))}
        />
      </Group>

      <Group legend={vocabulary.groups.tags}>
        {/*
          A FREE VOCABULARY, so only tags with campaigns behind them are listed —
          the whole list is unbounded and is not a thing that can be rendered.
          A tag with nothing behind it is not a filter. Several tags mean EVERY
          one of them, not any, which is the one dimension where adding a value
          narrows rather than widens; the hint says so, because a control that
          behaves differently from every other control beside it has to.
        */}
        {(facets?.tags ?? []).length === 0 ? (
          <p className="text-[13px] text-white/40">{copy.noTags}</p>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-white/64">{copy.tagsHint}</p>
            <ul className="flex flex-col gap-2.5">
              {(facets?.tags ?? []).map((tag) => (
                <FacetCheckbox
                  none={copy.none}
                  key={tag.slug}
                  label={tag.name}
                  count={tag.count}
                  checked={filters.tags.includes(tag.slug)}
                  onToggle={() => onChange(toggleTag(filters, tag.slug))}
                />
              ))}
            </ul>
          </>
        )}
      </Group>
    </form>
  );
}
