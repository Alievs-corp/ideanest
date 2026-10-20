'use client';

import { Suspense, lazy, useState } from 'react';
import {
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  TextInput,
} from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  PARTNER_SECTIONS,
  formatShare,
  readPartners,
  removePartner,
  savePartner,
  shareFromInput,
  type Partner,
  type PartnerSection,
} from '../../lib/admin/partners';
import type { AdminUser } from '../../lib/admin/api';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import type { Locale } from '../../lib/i18n/locale';
import type { PartnerManagerCopy } from '../../lib/i18n/admin/partner-copy';
import { AccountPicker } from './AccountPicker';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/* Fetched when it opens: `ConfirmDialog` has why. */
const ConfirmDialog = lazy(() =>
  import('./ConfirmDialog').then((module) => ({ default: module.ConfirmDialog })),
);

/**
 * The service's refusal in the reader's language.
 *
 * <p>The service's `detail` is English and was what an Azerbaijani screen printed — "A partner
 * may hold no other staff role: roles add up…". Each code it sends has a sentence here, with the
 * share it says is left written the reader's way and the roles named rather than spelled.
 */
function partnerMessageFor(cause: unknown, copy: PartnerManagerCopy, locale: Locale): string {
  if (cause instanceof ApiError) {
    const code = cause.problem?.code;
    const sentence = code == null ? undefined : copy.errors[code];
    if (sentence !== undefined) {
      const meta = cause.problem?.meta ?? {};
      const available = typeof meta.available === 'string' ? formatShare(meta.available, locale) : '';
      // The service joins them with commas; a list is read the same way.
      const held: readonly unknown[] =
        typeof meta.roles === 'string' ? meta.roles.split(',') : Array.isArray(meta.roles) ? meta.roles : [];
      const roles = held
        .filter((role): role is string => typeof role === 'string' && role !== '')
        .map((role) => copy.role[role] ?? role)
        .join(', ');
      return fillPlaceholders(sentence, { available, roles });
    }
  }
  return consoleMessageFor(cause, copy.subject, copy.refusals);
}

/**
 * The partner list: who sees a share of the financial figures, what share, and which console
 * sections are open to them — #206, part of #202.
 *
 * <h2>The service decides; this screen says it in the reader's words</h2>
 *
 * <p>Every rule lives in the service and is checked there: only a super admin may manage
 * partners, the percentages may not add up to more than 100, a partner holds no other staff
 * role, and only two sections can be opened at all. The share's own shape is checked here too,
 * before the request, so that the comma the hint writes is accepted and a mistake is named in
 * the reader's language — `shareFromInput` says why that is not a second authority.
 *
 * <h2>What it does say out loud</h2>
 *
 * <p>How much of the whole is left, because the one constraint an operator runs into is the
 * total. Why only two sections are offered. And, before a partnership ends, what ending it
 * closes: it was one click on a row, with no confirmation, for a change that takes a
 * partner's statistics away on their next request.
 *
 * <p>MOTION: none beyond the modal's own entry, like every console screen.
 * `docs/motion-system.md` §5.
 */
export interface PartnerManagerProps {
  readonly copy: PartnerManagerCopy;
}

export function PartnerManager({ copy }: PartnerManagerProps) {
  const locale = useRouteLocale();
  const roster = useConsoleResource((signal) => readPartners(signal), copy.subject, copy.refusals, []);

  const names = useDirectoryNames(
    (roster.data?.partners ?? []).map((partner) => partner.accountId),
    [],
  );

  const [account, setAccount] = useState<AdminUser | null>(null);
  const [percentage, setPercentage] = useState('');
  const [sections, setSections] = useState<readonly PartnerSection[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  /*
   * Where the last write's answer is drawn. A row's save or end used to report under the add
   * form, a screen away from the row it was about.
   */
  const [rowNotice, setRowNotice] = useState<{ readonly tone: 'success' | 'danger'; readonly text: string } | null>(
    null,
  );
  const [added, setAdded] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [ending, setEnding] = useState<Partner | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  if (roster.status === 'signed-out' || roster.status === 'forbidden') {
    return (
      <ConsoleRefusal
        status={roster.status}
        capability={roster.capability}
        subject={copy.subject}
        copy={copy.refusals}
      />
    );
  }

  const nameOf = (id: string) => names.accounts.get(id)?.name ?? id;
  const invalidShare = copy.errors.INVALID_PARTNER_SHARE ?? copy.percentageHint;

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (account === null) return;

    const share = shareFromInput(percentage);
    if (share === null) {
      setShareError(invalidShare);
      return;
    }

    setBusy(true);
    setShareError(null);
    setAddError(null);
    setAdded(null);
    setRowNotice(null);
    try {
      const saved = await savePartner({ accountId: account.id, percentage: share, sections });
      setAdded(
        fillPlaceholders(copy.savedNotice, {
          name: account.name,
          percentage: formatShare(saved.percentage, locale),
        }),
      );
      setAccount(null);
      setPercentage('');
      setSections([]);
      roster.reload();
    } catch (cause) {
      setAddError(partnerMessageFor(cause, copy, locale));
    } finally {
      setBusy(false);
    }
  }

  async function change(partner: Partner, share: string, nextSections: readonly PartnerSection[]): Promise<boolean> {
    setBusy(true);
    setRowNotice(null);
    setAdded(null);
    try {
      const saved = await savePartner({ accountId: partner.accountId, percentage: share, sections: nextSections });
      setRowNotice({
        tone: 'success',
        text: fillPlaceholders(copy.savedNotice, {
          name: nameOf(partner.accountId),
          percentage: formatShare(saved.percentage, locale),
        }),
      });
      roster.reload();
      return true;
    } catch (cause) {
      setRowNotice({ tone: 'danger', text: partnerMessageFor(cause, copy, locale) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function end(partner: Partner): Promise<void> {
    setBusy(true);
    setEndError(null);
    setRowNotice(null);
    setAdded(null);
    try {
      await removePartner(partner.accountId);
      setRowNotice({
        tone: 'success',
        text: fillPlaceholders(copy.removedNotice, { name: nameOf(partner.accountId) }),
      });
      setEnding(null);
      roster.reload();
    } catch (cause) {
      // The dialog stays open with the refusal in it: nothing changed.
      setEndError(partnerMessageFor(cause, copy, locale));
    } finally {
      setBusy(false);
    }
  }

  const partners = roster.data?.partners ?? [];
  const showList = roster.status !== 'failed' && roster.data !== null;

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      {/* ---- who is a partner ---------------------------------------------- */}

      <section aria-labelledby="partner-roster-heading">
        <h2 id="partner-roster-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
          {copy.rosterHeading}
        </h2>

        {showList && roster.data && (
          <p className="mt-2 text-sm text-white/64">
            {fillPlaceholders(copy.allocation, {
              allocated: formatShare(roster.data.allocated, locale),
              remaining: formatShare(roster.data.remaining, locale),
            })}
          </p>
        )}

        {roster.status === 'loading' && roster.data === null && (
          <SkeletonGroup label={copy.loadingRoster} className="mt-4">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="0.875rem" width="60%" className="mt-3" />
          </SkeletonGroup>
        )}

        {roster.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {roster.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={roster.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        <div role="status" aria-live="polite" className="empty:hidden">
          {rowNotice?.tone === 'success' && (
            <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
              {rowNotice.text}
            </InlineAlert>
          )}
        </div>
        {rowNotice?.tone === 'danger' && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {rowNotice.text}
          </InlineAlert>
        )}

        {showList && partners.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.rosterEmptyTitle}
            description={copy.rosterEmptyBody}
          />
        )}

        {showList && partners.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {partners.map((partner) => (
              <PartnerRow
                // Keyed by the saved state too, so a row's fields start again from what the
                // service now holds after a save rather than from what was typed before it.
                key={`${partner.accountId}:${partner.updatedAt}`}
                partner={partner}
                names={names}
                copy={copy}
                locale={locale}
                busy={busy}
                invalidShare={invalidShare}
                onSave={(share, nextSections) => change(partner, share, nextSections)}
                onEnd={() => {
                  setEndError(null);
                  setEnding(partner);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- adding one ---------------------------------------------------- */}

      <section aria-labelledby="partner-add-heading">
        <h2 id="partner-add-heading" className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg">
          {copy.addHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.addIntro}</p>

        <form onSubmit={(event) => void add(event)} className="mt-4 flex flex-col gap-4">
          <AccountPicker chosen={account} onChoose={setAccount} copy={copy.picker} disabled={busy} />

          <Field
            label={copy.percentageLabel}
            hint={copy.percentageHint}
            error={shareError}
            className="max-w-[360px]"
          >
            <TextInput
              inputMode="decimal"
              value={percentage}
              onChange={(event) => {
                setPercentage(event.target.value);
                setShareError(null);
              }}
              maxLength={10}
            />
          </Field>

          <SectionPicker copy={copy} value={sections} onChange={setSections} disabled={busy} />

          <div className="flex flex-wrap items-center gap-3">
            <Pill
              type="submit"
              variant="outline"
              size="sm"
              disabled={busy || account === null || percentage.trim() === ''}
            >
              {busy ? copy.working : copy.addPartner}
            </Pill>
            {account === null && <p className="text-xs text-white/48">{copy.chooseAccountFirst}</p>}
          </div>
        </form>

        <div role="status" aria-live="polite" className="empty:hidden">
          {added && (
            <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
              {added}
            </InlineAlert>
          )}
        </div>
        {addError && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {addError}
          </InlineAlert>
        )}
      </section>

      {ending !== null && (
        <Suspense fallback={null}>
          <ConfirmDialog
            title={fillPlaceholders(copy.endTitle, { name: nameOf(ending.accountId) })}
            body={copy.endBody}
            confirmLabel={copy.remove}
            busyLabel={copy.working}
            cancelLabel={copy.cancel}
            busy={busy}
            error={endError}
            onCancel={() => setEnding(null)}
            onConfirm={() => void end(ending)}
          />
        </Suspense>
      )}
    </div>
  );
}

interface PartnerRowProps {
  readonly partner: Partner;
  readonly names: ReturnType<typeof useDirectoryNames>;
  readonly copy: PartnerManagerCopy;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly invalidShare: string;
  /** Resolves to whether the service took it. */
  readonly onSave: (share: string, sections: readonly PartnerSection[]) => Promise<boolean>;
  readonly onEnd: () => void;
}

/** One partner, with their percentage and sections editable in place. */
function PartnerRow({ partner, names, copy, locale, busy, invalidShare, onSave, onEnd }: PartnerRowProps) {
  // Shown the reader's way — "12,5" — and read back through `shareFromInput`.
  const [percentage, setPercentage] = useState(() => editableShare(partner.percentage, locale));
  const [sections, setSections] = useState<readonly PartnerSection[]>(partner.sections);
  const [shareError, setShareError] = useState<string | null>(null);

  const share = shareFromInput(percentage);
  const same =
    share !== null &&
    Number(share) === Number(partner.percentage) &&
    sections.length === partner.sections.length &&
    sections.every((section) => partner.sections.includes(section));

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-white">
            <EntityName
              id={partner.accountId}
              names={names}
              kind="account"
              copy={copy.identity}
              copyable
            />
            <Tag>{formatShare(partner.percentage, locale)}</Tag>
          </p>
          <p className="mt-1 text-xs text-white/48">
            {partner.sections.length === 0
              ? copy.sectionsNone
              : fillPlaceholders(copy.sectionsOpen, {
                  sections: partner.sections.map((section) => copy.sectionLabel[section]).join(', '),
                })}
            {' · '}
            {fillPlaceholders(copy.updatedLine, { date: formatDate(partner.updatedAt, locale) })}
          </p>
        </div>

        <Pill variant="ghost" size="sm" disabled={busy} onClick={onEnd}>
          {copy.remove}
        </Pill>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Field
          label={copy.percentageLabel}
          hint={copy.percentageHint}
          error={shareError}
          className="max-w-[360px]"
        >
          <TextInput
            inputMode="decimal"
            value={percentage}
            onChange={(event) => {
              setPercentage(event.target.value);
              setShareError(null);
            }}
            maxLength={10}
          />
        </Field>

        <SectionPicker copy={copy} value={sections} onChange={setSections} disabled={busy} />

        <div>
          <Pill
            variant="outline"
            size="sm"
            disabled={busy || same || percentage.trim() === ''}
            onClick={() => {
              if (share === null) {
                setShareError(invalidShare);
                return;
              }
              void onSave(share, sections);
            }}
          >
            {busy ? copy.working : copy.saveChanges}
          </Pill>
        </div>
      </div>
    </li>
  );
}

/** "12.50" from the service as the reader would type it: "12,5" in a comma language. */
function editableShare(percentage: string, locale: Locale): string {
  const trimmed = percentage.includes('.') ? percentage.replace(/0+$/, '').replace(/\.$/, '') : percentage;
  return locale === 'en' ? trimmed : trimmed.replace('.', ',');
}

interface SectionPickerProps {
  readonly copy: PartnerManagerCopy;
  readonly value: readonly PartnerSection[];
  readonly onChange: (next: readonly PartnerSection[]) => void;
  readonly disabled: boolean;
}

/**
 * The sections that can be opened to a partner: two, and the note says why only two.
 *
 * <p>A fieldset with a legend, so a screen reader announces "Also open to this partner" once and
 * then each checkbox by its own name. Colour carries nothing here: a checked box is a checked
 * box.
 */
function SectionPicker({ copy, value, onChange, disabled }: SectionPickerProps) {
  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-sm text-white">{copy.sectionsLegend}</legend>
      {PARTNER_SECTIONS.map((section) => (
        <Checkbox
          key={section}
          label={copy.sectionLabel[section]}
          description={copy.sectionHint[section]}
          checked={value.includes(section)}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...value.filter((held) => held !== section), section]
                : value.filter((held) => held !== section),
            )
          }
        />
      ))}
      <p className="text-xs text-white/48">{copy.sectionsNote}</p>
    </fieldset>
  );
}
