'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  TextInput,
} from '@ideanest/ui';
import {
  asPercentage,
  fixedFrom,
  formatFixedAmount,
  plainRate,
  rateFrom,
  readCategoryChoices,
  readFeeHistory,
  replaceFeeSchedule,
  type FeeHistory,
  type FeeSchedule,
  type FeeScope,
} from '../../lib/admin/fees';
import { codedRefusalFor, isIdentifier, refusalCode, refusalMeta } from '../../lib/admin/coded-refusal';
import { bakuDate } from '../../lib/admin/console-dates';
import { shortId } from '../../lib/admin/refusals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { FeeEditorCopy } from '../../lib/i18n/admin/money-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

const SCOPES: readonly FeeScope[] = ['PLATFORM', 'CATEGORY', 'PROJECT'];
const CURRENCY = 'AZN';

/**
 * §4.11's AD-11: platform and processing rates, with exceptions — §9, issue #311.
 *
 * <h2>There is no edit, and the screen says so</h2>
 *
 * A change closes the schedule in force for its scope and opens a new one beginning now, because a
 * rate is a term rather than a setting. So the form starts from the terms in force for the scope it
 * is about — the open schedule, or the platform's default terms the service reports when none is
 * open — and only the field somebody changes changes. It used to start from hard-coded numbers, and
 * an operator who meant to move one rate replaced all three.
 *
 * <h2>Replacing asks first, with every term old and new</h2>
 *
 * One press closed the schedule every future payout is priced under. The press now shows the terms
 * in force beside the new ones, says what is not changing, and opens them only on the second press.
 *
 * <h2>An exception names its category or campaign</h2>
 *
 * A category is chosen from the taxonomy rather than typed; a campaign is typed as its identifier,
 * checked before it is sent, and named back from the console directory. The service refuses an
 * identifier that names nothing, and the list draws names rather than eight hexadecimal characters.
 *
 * <h2>Rates are fractions, and a comma is a decimal mark</h2>
 *
 * `0,05` and `0.05` are both five percent; the wire carries the dotted string that gets multiplied.
 */
export interface FeeEditorProps {
  readonly copy: FeeEditorCopy;
}

interface Terms {
  readonly platformRate: string;
  readonly processingRate: string;
  readonly processingFixed: string;
}

/** The terms a new schedule for this scope starts from, and whether they are that scope's own. */
function startingTerms(
  scope: FeeScope,
  ref: string,
  history: FeeHistory | null,
): { readonly terms: Terms; readonly own: boolean; readonly key: string } | null {
  if (history === null) return null;
  const open = history.schedules.filter((schedule) => schedule.open);
  const own = open.find(
    (schedule) => schedule.scope === scope && (scope === 'PLATFORM' || schedule.scopeRef === ref),
  );
  if (own !== undefined) return { terms: termsOf(own), own: true, key: own.id };

  // An exception starts from what such a payout is charged today: the platform's terms.
  const platform = open.find((schedule) => schedule.scope === 'PLATFORM');
  if (platform !== undefined) return { terms: termsOf(platform), own: false, key: `${scope}:${ref}:${platform.id}` };

  const defaults = history.defaults;
  if (defaults == null) return null;
  return {
    terms: {
      platformRate: plainRate(defaults.platformRate),
      processingRate: plainRate(defaults.processingRate),
      processingFixed: '0',
    },
    own: false,
    key: `${scope}:${ref}:default`,
  };
}

function termsOf(schedule: FeeSchedule): Terms {
  return {
    platformRate: plainRate(schedule.platformRate),
    processingRate: plainRate(schedule.processingRate),
    processingFixed: plainRate(schedule.processingFixed),
  };
}

/** Platform first, then category exceptions, then campaign exceptions — newest first within each. */
function inScopeOrder(schedules: readonly FeeSchedule[]): FeeSchedule[] {
  return [...schedules].sort((a, b) => SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope));
}

export function FeeEditor({ copy }: FeeEditorProps) {
  const locale = useRouteLocale();
  const history = useConsoleResource(
    (signal) => readFeeHistory(signal),
    copy.subject,
    copy.refusals,
    [],
  );
  const categories = useConsoleResource(
    (signal) => readCategoryChoices(signal),
    copy.subject,
    copy.refusals,
    [],
  );

  const [scope, setScope] = useState<FeeScope>('PLATFORM');
  const [scopeRef, setScopeRef] = useState('');
  const [platformRate, setPlatformRate] = useState('');
  const [processingRate, setProcessingRate] = useState('');
  const [processingFixed, setProcessingFixed] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState<string | null>(null);

  const ref = scope === 'PLATFORM' ? '' : scopeRef.trim();
  // A half-typed identifier is no scope yet: the fields do not jump about while it is being typed.
  const settledRef = isIdentifier(ref) ? ref.toLowerCase() : '';
  const start = useMemo(() => startingTerms(scope, settledRef, history.data), [scope, settledRef, history.data]);
  const startKey = start?.key ?? null;

  /*
   * The fields follow the scope: choosing a scope, or naming a different category or campaign, fills
   * them with what is in force there. Typing in one field touches nothing else.
   */
  useEffect(() => {
    if (start === null) return;
    setPlatformRate(start.terms.platformRate);
    setProcessingRate(start.terms.processingRate);
    setProcessingFixed(start.terms.processingFixed);
    setConfirming(false);
    // `start` is read through its key: a new object with the same terms must not reset what was typed.
  }, [startKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedules = history.data?.schedules ?? [];
  const typedCampaign = scope === 'PROJECT' && isIdentifier(ref) ? [ref] : [];
  const names = useDirectoryNames(
    [],
    [
      ...schedules.filter((schedule) => schedule.scope === 'PROJECT').flatMap((schedule) => schedule.scopeRef ?? []),
      ...typedCampaign,
    ],
  );

  if (history.status === 'signed-out' || history.status === 'forbidden') {
    return <ConsoleRefusal status={history.status} capability={history.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  const categoryList = categories.data ?? [];
  const categoryName = (id: string) => categoryList.find((choice) => choice.id === id)?.name ?? shortId(id);
  const campaignName = (id: string) => names.projects.get(id)?.title ?? shortId(id);
  const scopeName = (target: FeeScope, id: string | null | undefined): string =>
    target === 'PLATFORM' || id == null
      ? copy.scope[target]
      : fillPlaceholders(copy.scopeNamed, {
          scope: copy.scope[target],
          name: target === 'CATEGORY' ? categoryName(id) : campaignName(id),
        });

  const platform = rateFrom(platformRate);
  const processing = rateFrom(processingRate);
  const fixed = fixedFrom(processingFixed);
  const refValid = scope === 'PLATFORM' || isIdentifier(ref);
  const valid = platform !== undefined && processing !== undefined && fixed !== undefined && refValid && note.trim() !== '';
  /* The category list failed, so a category is typed the way a campaign is. */
  const typedCategory = scope === 'CATEGORY' && categories.status !== 'ready';

  function review(event: React.FormEvent): void {
    event.preventDefault();
    setChecked(true);
    setError(null);
    setWritten(null);
    if (valid) setConfirming(true);
  }

  async function replace(): Promise<void> {
    if (busy || platform === undefined || processing === undefined || fixed === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const schedule = await replaceFeeSchedule({
        scope,
        scopeRef: scope === 'PLATFORM' ? null : ref,
        platformRate: platform,
        processingRate: processing,
        processingFixed: fixed,
        currency: CURRENCY,
        note: note.trim(),
      });

      setWritten(
        fillPlaceholders(copy.openedNotice, {
          scope: scopeName(schedule.scope, schedule.scopeRef),
          date: bakuDate(schedule.effectiveFrom, locale),
        }),
      );
      setNote('');
      setChecked(false);
      setConfirming(false);
      history.reload();
    } catch (cause) {
      const code = refusalCode(cause);
      const words =
        code === 'FEE_SCOPE_UNKNOWN'
          ? { FEE_SCOPE_UNKNOWN: copy.errors[`FEE_SCOPE_UNKNOWN_${refusalMeta(cause, 'scope') ?? scope}`] ?? '' }
          : copy.errors;
      setError(codedRefusalFor(cause, words, copy.errors['INVALID_REQUEST'] ?? copy.refusals.refused, copy.subject, copy.refusals));
      setConfirming(false);
      // Somebody else opened terms first: what is in force is no longer what this form started from.
      if (code === 'FEE_SCHEDULE_CONFLICT') history.reload();
    } finally {
      setBusy(false);
    }
  }

  const open = inScopeOrder(schedules.filter((schedule) => schedule.open));
  const closed = schedules.filter((schedule) => !schedule.open);
  const defaults = history.data?.defaults;
  const shown = (rate: string | undefined, typed: string) => asPercentage(rate ?? typed, locale);

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      <section aria-labelledby="in-force-heading">
        <h2 id="in-force-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.inForceHeading}
        </h2>

        {history.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="0.875rem" width="60%" className="mt-3" />
          </SkeletonGroup>
        )}

        {history.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {history.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={history.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {history.status === 'ready' && open.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.emptyTitle}
            description={
              defaults == null
                ? undefined
                : fillPlaceholders(copy.emptyBody, {
                    platform: asPercentage(defaults.platformRate, locale),
                    processing: asPercentage(defaults.processingRate, locale),
                  })
            }
          />
        )}

        {history.status === 'ready' && open.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {open.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                name={scopeName(schedule.scope, schedule.scopeRef)}
                locale={locale}
                copy={copy}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="replace-heading">
        <h2 id="replace-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.replaceHeading}
        </h2>

        <form onSubmit={review} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field label={copy.scopeLabel} className="min-w-[180px]">
              <Select
                value={scope}
                disabled={confirming}
                onChange={(event) => {
                  setScope(event.target.value as FeeScope);
                  setScopeRef('');
                }}
              >
                {SCOPES.map((option) => (
                  <option key={option} value={option}>
                    {copy.scope[option]}
                  </option>
                ))}
              </Select>
            </Field>

            {scope === 'CATEGORY' && !typedCategory && (
              <Field label={copy.categoryLabel} className="min-w-[280px] flex-1">
                <Select
                  value={scopeRef}
                  placeholder={copy.categoryPlaceholder}
                  disabled={confirming}
                  onChange={(event) => setScopeRef(event.target.value)}
                >
                  {categoryList.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {(scope === 'PROJECT' || typedCategory) && (
              <Field
                label={scope === 'CATEGORY' ? copy.categoryLabel : copy.campaignLabel}
                hint={
                  scope === 'CATEGORY'
                    ? copy.categoriesUnavailable
                    : isIdentifier(ref) && names.projects.has(ref)
                      ? fillPlaceholders(copy.campaignFound, { name: campaignName(ref) })
                      : copy.scopeRefHint
                }
                error={checked && !refValid ? copy.scopeRefInvalid : undefined}
                className="min-w-[280px] flex-1"
              >
                <TextInput
                  value={scopeRef}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={confirming}
                  onChange={(event) => setScopeRef(event.target.value)}
                />
              </Field>
            )}
          </div>

          {start !== null && (scope === 'PLATFORM' || refValid) && (
            <p className="max-w-[62ch] text-xs text-fg-48">
              {start.own ? copy.prefilledFromSchedule : copy.prefilledFromDefault}
            </p>
          )}

          <div className="flex flex-wrap items-start gap-3">
            <Field
              label={copy.platformRateLabel}
              hint={fillPlaceholders(copy.fractionHint, { percentage: shown(platform, platformRate) })}
              error={platformRate !== '' && platform === undefined ? copy.rateInvalid : undefined}
              className="min-w-[180px]"
            >
              <TextInput
                inputMode="decimal"
                value={platformRate}
                disabled={confirming}
                onChange={(event) => setPlatformRate(event.target.value)}
              />
            </Field>

            <Field
              label={copy.processingRateLabel}
              hint={fillPlaceholders(copy.fractionHint, { percentage: shown(processing, processingRate) })}
              error={processingRate !== '' && processing === undefined ? copy.rateInvalid : undefined}
              className="min-w-[180px]"
            >
              <TextInput
                inputMode="decimal"
                value={processingRate}
                disabled={confirming}
                onChange={(event) => setProcessingRate(event.target.value)}
              />
            </Field>

            <Field
              label={copy.fixedLabel}
              hint={fillPlaceholders(copy.fixedHint, { currency: CURRENCY })}
              error={processingFixed !== '' && fixed === undefined ? copy.fixedInvalid : undefined}
              className="min-w-[180px]"
            >
              <TextInput
                inputMode="decimal"
                value={processingFixed}
                disabled={confirming}
                onChange={(event) => setProcessingFixed(event.target.value)}
              />
            </Field>
          </div>

          <Field label={copy.whyLabel} hint={copy.whyHint} required>
            <TextInput
              value={note}
              maxLength={2000}
              disabled={confirming}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {!confirming && (
            <div>
              <Pill type="submit" variant="outline" size="sm" disabled={busy || !valid}>
                {copy.open}
              </Pill>
            </div>
          )}
        </form>

        {confirming && start !== null && platform !== undefined && processing !== undefined && fixed !== undefined && (
          <div
            role="group"
            aria-label={copy.confirm.heading}
            className="mt-4 flex flex-col gap-3 rounded-lg border border-fg/16 p-4"
          >
            <h3 className="text-sm font-medium text-fg">{copy.confirm.heading}</h3>
            <p className="max-w-[62ch] text-sm text-fg-80">
              {fillPlaceholders(copy.confirm.intro, { scope: scopeName(scope, ref || null) })}
            </p>
            <table className="w-full max-w-[560px] text-left text-xs sm:text-sm">
              <thead>
                <tr className="text-xs text-fg-48">
                  <th scope="col" className="py-1 pr-3 sm:pr-4 font-normal">
                    <span className="sr-only">{copy.scopeLabel}</span>
                  </th>
                  <th scope="col" className="py-1 pr-3 sm:pr-4 font-normal">
                    {copy.confirm.was}
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    {copy.confirm.becomes}
                  </th>
                </tr>
              </thead>
              <tbody>
                <ChangeRow
                  label={copy.platformRateLabel}
                  was={asPercentage(start.terms.platformRate, locale)}
                  becomes={asPercentage(platform, locale)}
                  same={rateFrom(start.terms.platformRate) === platform}
                  unchanged={copy.confirm.unchanged}
                />
                <ChangeRow
                  label={copy.processingRateLabel}
                  was={asPercentage(start.terms.processingRate, locale)}
                  becomes={asPercentage(processing, locale)}
                  same={rateFrom(start.terms.processingRate) === processing}
                  unchanged={copy.confirm.unchanged}
                />
                <ChangeRow
                  label={copy.fixedLabel}
                  was={formatFixedAmount(start.terms.processingFixed, CURRENCY)}
                  becomes={formatFixedAmount(fixed, CURRENCY)}
                  same={formatFixedAmount(start.terms.processingFixed, CURRENCY) === formatFixedAmount(fixed, CURRENCY)}
                  unchanged={copy.confirm.unchanged}
                />
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2">
              <Pill size="sm" autoFocus aria-disabled={busy} onClick={() => void replace()}>
                {busy ? copy.working : copy.confirm.action}
              </Pill>
              <Pill variant="ghost" size="sm" aria-disabled={busy} onClick={() => (busy ? undefined : setConfirming(false))}>
                {copy.confirm.back}
              </Pill>
            </div>
          </div>
        )}

        {written && (
          <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
            {written}
          </InlineAlert>
        )}
        {error && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {error}
          </InlineAlert>
        )}
      </section>

      {history.status === 'ready' && closed.length > 0 && (
        <section aria-labelledby="past-terms-heading">
          <h2 id="past-terms-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
            {copy.pastHeading}
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.pastIntro}</p>

          <ul className="mt-4 flex list-none flex-col gap-2">
            {closed.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                name={scopeName(schedule.scope, schedule.scopeRef)}
                locale={locale}
                copy={copy}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One term, before and after, and a word when it is not changing — not colour alone. */
function ChangeRow({
  label,
  was,
  becomes,
  same,
  unchanged,
}: {
  readonly label: string;
  readonly was: string;
  readonly becomes: string;
  readonly same: boolean;
  readonly unchanged: string;
}) {
  return (
    <tr className="border-t border-fg/8">
      <th scope="row" className="py-1.5 pr-3 sm:pr-4 font-normal text-fg-64">
        {label}
      </th>
      <td className="py-1.5 pr-3 sm:pr-4 font-mono tabular-nums text-fg-64">{was}</td>
      <td className={same ? 'py-1.5 font-mono tabular-nums text-fg-48' : 'py-1.5 font-mono font-medium tabular-nums text-fg'}>
        {becomes}
        {same && <span className="ml-2 font-sans text-xs">({unchanged})</span>}
      </td>
    </tr>
  );
}

/** One set of terms and the window it applied over. */
function ScheduleRow({
  schedule,
  name,
  locale,
  copy,
}: {
  readonly schedule: FeeSchedule;
  readonly name: string;
  readonly locale: Locale;
  readonly copy: FeeEditorCopy;
}) {
  return (
    <li className="rounded-lg border border-fg/8 bg-surface-1 p-4">
      <p className="text-sm text-fg">{name}</p>

      <p className="mt-2 text-sm text-fg-80">
        {fillPlaceholders(copy.rates, {
          platform: asPercentage(schedule.platformRate, locale),
          processing: asPercentage(schedule.processingRate, locale),
          // The column holds four decimals, and a fixed amount of 0.0025 is real: every decimal that
          // is not a trailing zero is shown, where `formatMoney` would print 0.00.
          fixed: formatFixedAmount(schedule.processingFixed, schedule.currency),
        })}
      </p>

      <p className="mt-2 text-xs text-fg-40">
        {fillPlaceholders(copy.window, {
          from: bakuDate(schedule.effectiveFrom, locale),
          to: schedule.effectiveTo == null ? copy.now : bakuDate(schedule.effectiveTo, locale),
          note: schedule.note,
        })}
      </p>
    </li>
  );
}
