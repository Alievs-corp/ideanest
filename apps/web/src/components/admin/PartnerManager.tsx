'use client';

import { useState } from 'react';
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
import {
  PARTNER_SECTIONS,
  readPartners,
  removePartner,
  savePartner,
  type Partner,
  type PartnerSection,
} from '../../lib/admin/partners';
import type { AdminUser } from '../../lib/admin/api';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { PartnerManagerCopy } from '../../lib/i18n/admin/partner-copy';
import { AccountPicker } from './AccountPicker';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * The partner list: who sees a share of the financial figures, what share, and which console
 * sections are open to them — #206, part of #202.
 *
 * <h2>This screen decides nothing</h2>
 *
 * <p>Every rule lives in the service and is checked there: only a super admin may manage
 * partners, the percentages may not add up to more than 100, a partner holds no other staff
 * role, and only two sections can be opened at all. This screen shows the answer and passes on
 * the refusal in the service's own words (`consoleMessageFor` falls back to its `detail`), so
 * there is no second copy of a rule here to drift out of step.
 *
 * <h2>What it does say out loud</h2>
 *
 * <p>How much of the whole is left, because the one constraint an operator runs into is the
 * total, and "at most 20.00" in a refusal is a worse place to learn it than a line above the
 * form. And why only two sections are offered: a reader who sees two checkboxes and expects
 * sixteen would otherwise go looking for the other fourteen.
 *
 * <p>MOTION: none, like every console screen. `docs/motion-system.md` §5.
 */
export interface PartnerManagerProps {
  readonly copy: PartnerManagerCopy;
}

export function PartnerManager({ copy }: PartnerManagerProps) {
  const roster = useConsoleResource((signal) => readPartners(signal), copy.subject, copy.refusals, []);

  const names = useDirectoryNames(
    (roster.data?.partners ?? []).map((partner) => partner.accountId),
    [],
  );

  const [account, setAccount] = useState<AdminUser | null>(null);
  const [percentage, setPercentage] = useState('');
  const [sections, setSections] = useState<readonly PartnerSection[]>([]);

  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

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

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (account === null || percentage.trim() === '') return;

    setBusy(true);
    setWriteError(null);
    setWritten(null);
    try {
      const saved = await savePartner({
        accountId: account.id,
        percentage: percentage.trim(),
        sections,
      });
      setWritten(fillPlaceholders(copy.savedNotice, { name: account.name, percentage: saved.percentage }));
      setAccount(null);
      setPercentage('');
      setSections([]);
      roster.reload();
    } catch (cause) {
      setWriteError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  async function change(partner: Partner, nextPercentage: string, nextSections: readonly PartnerSection[]) {
    setBusy(true);
    setWriteError(null);
    setWritten(null);
    try {
      const saved = await savePartner({
        accountId: partner.accountId,
        percentage: nextPercentage.trim(),
        sections: nextSections,
      });
      setWritten(
        fillPlaceholders(copy.savedNotice, {
          name: names.accounts.get(partner.accountId)?.name ?? partner.accountId,
          percentage: saved.percentage,
        }),
      );
      roster.reload();
    } catch (cause) {
      setWriteError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  async function end(partner: Partner): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setWritten(null);
    try {
      await removePartner(partner.accountId);
      setWritten(
        fillPlaceholders(copy.removedNotice, {
          name: names.accounts.get(partner.accountId)?.name ?? partner.accountId,
        }),
      );
      roster.reload();
    } catch (cause) {
      setWriteError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  const partners = roster.data?.partners ?? [];

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.noticeTitle}>
        {copy.noticeBody}
      </InlineAlert>

      {/* ---- who is a partner ---------------------------------------------- */}

      <section aria-labelledby="partner-roster-heading">
        <h2 id="partner-roster-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.rosterHeading}
        </h2>

        {roster.status === 'ready' && roster.data && (
          <p className="mt-2 text-sm text-white/64">
            {fillPlaceholders(copy.allocation, {
              allocated: roster.data.allocated,
              remaining: roster.data.remaining,
            })}
          </p>
        )}

        {roster.status === 'loading' && (
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

        {roster.status === 'ready' && partners.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.rosterEmptyTitle}
            description={copy.rosterEmptyBody}
          />
        )}

        {roster.status === 'ready' && partners.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-3">
            {partners.map((partner) => (
              <PartnerRow
                key={partner.accountId}
                partner={partner}
                names={names}
                copy={copy}
                busy={busy}
                onSave={(nextPercentage, nextSections) => void change(partner, nextPercentage, nextSections)}
                onEnd={() => void end(partner)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- adding one ---------------------------------------------------- */}

      <section aria-labelledby="partner-add-heading">
        <h2 id="partner-add-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.addHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.addIntro}</p>

        <form onSubmit={(event) => void add(event)} className="mt-4 flex flex-col gap-4">
          <AccountPicker chosen={account} onChoose={setAccount} copy={copy.picker} disabled={busy} />

          <Field label={copy.percentageLabel} hint={copy.percentageHint} className="max-w-[260px]">
            <TextInput
              inputMode="decimal"
              value={percentage}
              onChange={(event) => setPercentage(event.target.value)}
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

        {written && (
          <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
            {written}
          </InlineAlert>
        )}
        {writeError && (
          <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
            {writeError}
          </InlineAlert>
        )}
      </section>
    </div>
  );
}

interface PartnerRowProps {
  readonly partner: Partner;
  readonly names: ReturnType<typeof useDirectoryNames>;
  readonly copy: PartnerManagerCopy;
  readonly busy: boolean;
  readonly onSave: (percentage: string, sections: readonly PartnerSection[]) => void;
  readonly onEnd: () => void;
}

/** One partner, with their percentage and sections editable in place. */
function PartnerRow({ partner, names, copy, busy, onSave, onEnd }: PartnerRowProps) {
  const [percentage, setPercentage] = useState(partner.percentage);
  const [sections, setSections] = useState<readonly PartnerSection[]>(partner.sections);

  const same =
    percentage.trim() === partner.percentage &&
    sections.length === partner.sections.length &&
    sections.every((section) => partner.sections.includes(section));

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white">
            <EntityName
              id={partner.accountId}
              names={names}
              kind="account"
              copy={copy.identity}
              copyable
            />{' '}
            <Tag className="ml-1">{partner.percentage}%</Tag>
          </p>
          <p className="mt-1 text-xs text-white/48">
            {partner.sections.length === 0
              ? copy.sectionsNone
              : fillPlaceholders(copy.sectionsOpen, {
                  sections: partner.sections.map((section) => copy.sectionLabel[section]).join(', '),
                })}
            {' · '}
            {fillPlaceholders(copy.updatedLine, { date: new Date(partner.updatedAt).toISOString().slice(0, 10) })}
          </p>
        </div>

        <Pill variant="ghost" size="sm" disabled={busy} onClick={onEnd}>
          {copy.remove}
        </Pill>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Field label={copy.percentageLabel} hint={copy.percentageHint} className="max-w-[260px]">
          <TextInput
            inputMode="decimal"
            value={percentage}
            onChange={(event) => setPercentage(event.target.value)}
            maxLength={10}
          />
        </Field>

        <SectionPicker copy={copy} value={sections} onChange={setSections} disabled={busy} />

        <div>
          <Pill
            variant="outline"
            size="sm"
            disabled={busy || same || percentage.trim() === ''}
            onClick={() => onSave(percentage, sections)}
          >
            {busy ? copy.working : copy.saveChanges}
          </Pill>
        </div>
      </div>
    </li>
  );
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
