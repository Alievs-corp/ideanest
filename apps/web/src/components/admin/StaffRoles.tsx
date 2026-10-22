'use client';

import { Suspense, lazy, useState } from 'react';
import { EmptyState, Field, InlineAlert, Pill, Select, Skeleton, SkeletonGroup, Tag, TextInput } from '@ideanest/ui';
import { Link } from '../../i18n/navigation';
import { ApiError } from '../../lib/api/problem';
import {
  ROLE_CAPABILITIES,
  grantRole,
  readMembership,
  readRoleMatrix,
  readRoster,
  revokeRole,
  type StaffCapability,
  type StaffGrant,
  type StaffRole,
} from '../../lib/admin/staff';
import type { AdminUser } from '../../lib/admin/api';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import type { StaffRolesCopy } from '../../lib/i18n/admin/people-copy';
import { AccountPicker } from './AccountPicker';
import { RoleCapabilityEditor } from './RoleCapabilityEditor';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/*
 * What can be granted from here. `SUPER_ADMIN` is what `ADMINISTRATOR` was called until #212.
 * `PARTNER` is deliberately not offered: a partner needs a percentage and a list of sections,
 * and a grant without them opens nothing, so partners are made and changed only on
 * `/admin/partners`, where those are set together with the role. The service refuses it here
 * as well since #501, and refuses a staff role to an account that is a partner.
 */
const ROLES: readonly StaffRole[] = [
  'MODERATOR',
  'CURATOR',
  'FINANCE',
  'COMPLIANCE',
  'SUPER_ADMIN',
];

/* Fetched when it opens: `ConfirmDialog` has why. */
const ConfirmDialog = lazy(() =>
  import('./ConfirmDialog').then((module) => ({ default: module.ConfirmDialog })),
);

/** One person on the roster and every role they were granted, in the service's order. */
interface Holder {
  readonly accountId: string;
  readonly grants: readonly StaffGrant[];
}

/*
 * The roster grouped by person. The service answers one row per grant, and the screen drew one
 * card per grant — so somebody holding two roles was two cards with the same name, each with its
 * own "Withdraw", and "who may do what here" had to be assembled by the reader.
 */
function holdersOf(grants: readonly StaffGrant[]): readonly Holder[] {
  const byAccount = new Map<string, StaffGrant[]>();
  for (const grant of grants) {
    const held = byAccount.get(grant.accountId);
    if (held === undefined) byAccount.set(grant.accountId, [grant]);
    else held.push(grant);
  }
  return [...byAccount].map(([accountId, held]) => ({ accountId, grants: held }));
}

/** What a refused grant or withdrawal says: the screen's own words where it has them. */
function writeMessageFor(cause: unknown, copy: StaffRolesCopy): string {
  const code = cause instanceof ApiError ? cause.problem?.code : undefined;
  if (code !== undefined && code !== null && copy.errors[code] !== undefined) return copy.errors[code];
  return consoleMessageFor(cause, copy.subject, copy.refusals);
}

/**
 * §4.11's role model, as a screen — issue #295.
 *
 * <h2>Two panels, and the first one is about the reader</h2>
 *
 * The console knows what the person reading it may do, so the first thing this screen shows is
 * that — every capability they hold and the roles it came from. The commonest question a member
 * of staff has about a console is why a screen they were told about is not on their rail, and
 * this answers it without anybody having to ask an administrator.
 *
 * <p><strong>In sentences.</strong> The capabilities were twenty-one uppercase identifiers —
 * `READ_ACCEPTANCE_RECORD`, `GRANT_COMPLIANCE_OVERRIDE` — with the sentence hidden on a hover
 * title, which nobody on a phone and few people anywhere ever saw. The sentence leads now; the
 * identifier stays beside it, small, because it is what somebody quotes when asking for a role
 * and what the service names back in a refusal.
 *
 * <h2>A super admin gets the role editor there instead — V114</h2>
 *
 * <p>Somebody who holds `ADMINISTER_STAFF` already holds every capability, so a list of them
 * told a super admin nothing. In its place is `RoleCapabilityEditor`: choose a role and switch
 * on or off what it confers. Everybody else keeps the read-only list of their own.
 *
 * <h2>Bootstrapped administrators are called out</h2>
 *
 * An account that is staff through `MODERATOR_EMAILS` rather than through a grant cannot be
 * withdrawn from this screen — it is in a deployment's environment, and the only way to remove
 * it is to change that and restart.
 *
 * <h2>Everybody on it has a name — issue #402</h2>
 *
 * <p>Resolved through the console directory, with the fragment beside each name because that is
 * what somebody quotes to an engineer. The grant form takes an {@link AccountPicker}, not a UUID.
 *
 * <h2>Withdrawing asks first</h2>
 *
 * <p>One click took a role away — the reader's own super-admin included — on the screen that
 * decides who can move money. It is a confirmation now, which says what closes and, on the
 * reader's own grant, that it closes for them.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives an administrative surface 150ms of colour on a control and
 * nothing that moves, beyond the modal's own entry.
 */
export interface StaffRolesProps {
  readonly copy: StaffRolesCopy;
}

export function StaffRoles({ copy }: StaffRolesProps) {
  const locale = useRouteLocale();
  const me = useConsoleResource(
    (signal) => readMembership(signal),
    copy.meSubject,
    copy.refusals,
    [],
  );
  const roster = useConsoleResource(
    (signal) => readRoster(signal),
    copy.subject,
    copy.refusals,
    [],
  );

  /*
   * The role editor's read, made only for a reader who may use it: everybody else would get a
   * 403 for a panel they are not shown. `null` is "not asked", and the grant form then falls back
   * to the defaults in `ROLE_CAPABILITIES`.
   */
  const administers = me.data?.capabilities.includes('ADMINISTER_STAFF') ?? false;
  const matrix = useConsoleResource(
    (signal) => (administers ? readRoleMatrix(signal) : Promise.resolve(null)),
    copy.editor.subject,
    copy.refusals,
    [administers],
  );

  const [account, setAccount] = useState<AdminUser | null>(null);
  const [role, setRole] = useState<StaffRole>('MODERATOR');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [written, setWritten] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<StaffGrant | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  /*
   * Everybody this screen mentions: the reader, whoever holds a grant, and whoever made
   * it. Named through the console directory since #402.
   */
  const names = useDirectoryNames(
    [
      me.data?.accountId ?? null,
      ...(roster.data?.grants.flatMap((grant) => [grant.accountId, grant.grantedBy]) ?? []),
    ].filter((id): id is string => id != null),
    [],
  );

  // `me` is read first and refuses nobody, so a signed-out reader is caught here rather
  // than by the roster — which would otherwise report "not staff" to somebody whose session
  // had merely expired.
  if (me.status === 'signed-out') {
    return <ConsoleRefusal status="signed-out" subject={copy.subject} copy={copy.refusals} />;
  }

  const nameOf = (id: string) => names.accounts.get(id)?.name ?? id;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (account === null) return;

    setBusy(true);
    setWriteError(null);
    setWritten(null);
    try {
      await grantRole(account.id, role, note.trim() === '' ? null : note.trim());
      // The person, not the fragment. "MODERATOR granted to 4a10278a" is a sentence
      // somebody has to go and check; this one can be read.
      setWritten(
        fillPlaceholders(copy.grantedNotice, { role: copy.role[role], name: account.name }),
      );
      setAccount(null);
      setNote('');
      roster.reload();
    } catch (cause) {
      setWriteError(writeMessageFor(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(grant: StaffGrant): Promise<void> {
    setBusy(true);
    setWithdrawError(null);
    setWritten(null);
    try {
      await revokeRole(grant.accountId, grant.role);
      setWritten(
        fillPlaceholders(copy.withdrawnNotice, {
          role: copy.role[grant.role],
          name: nameOf(grant.accountId),
        }),
      );
      setWithdrawing(null);
      roster.reload();
      // Withdrawing one's own role changes what this screen may show the reader.
      if (grant.accountId === me.data?.accountId) me.reload();
    } catch (cause) {
      // The dialog stays open with the refusal in it: nothing changed.
      setWithdrawError(writeMessageFor(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  const holders = holdersOf(roster.data?.grants ?? []);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="my-standing-heading">
        <h2 id="my-standing-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {administers ? copy.editor.heading : copy.myHeading}
        </h2>
        {administers && <p className="mt-2 max-w-[68ch] text-sm text-fg-64">{copy.editor.intro}</p>}

        {me.status === 'loading' && (
          <SkeletonGroup label={copy.loadingMe} className="mt-4">
            <Skeleton height="1rem" width="30%" />
            <Skeleton height="0.875rem" width="70%" className="mt-3" />
          </SkeletonGroup>
        )}

        {me.status === 'ready' && me.data !== null && !me.data.staff && (
          <InlineAlert variant="info" title={copy.notStaffTitle} className="mt-4">
            {copy.notStaffBody}
          </InlineAlert>
        )}

        {me.status === 'ready' && me.data !== null && me.data.staff && (
          <div className="mt-4 rounded-lg border border-fg/8 bg-surface-1 p-4">
            <p className="text-sm text-fg-64">
              {/*
                One sentence with two holes rather than three fragments: the identifier and the
                role tags are both styled, and Azerbaijani and Turkish put the verb after them.
              */}
              {fillNodes(copy.signedInAs, {
                id: (
                  <EntityName
                    id={me.data.accountId}
                    names={names}
                    kind="account"
                    copy={copy.identity}
                  />
                ),
                roles: me.data.roles.map((held) => (
                  <Tag key={held} className="mx-1">
                    {copy.role[held]}
                  </Tag>
                )),
              })}
            </p>

            {me.data.bootstrapped && (
              <InlineAlert variant="warning" title={copy.bootstrapTitle} className="mt-4">
                {fillNodes(copy.bootstrapBody, {
                  variable: <code className="font-mono text-xs">MODERATOR_EMAILS</code>,
                })}
              </InlineAlert>
            )}

            {!administers && (
              <CapabilityList capabilities={me.data.capabilities} copy={copy} className="mt-4" />
            )}
          </div>
        )}

        {administers && <RoleCapabilityEditor matrix={matrix} copy={copy} />}
      </section>

      <section aria-labelledby="roster-heading">
        <h2 id="roster-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.rosterHeading}
        </h2>

        {roster.status === 'forbidden' && (
          <InlineAlert variant="info" title={copy.rosterForbiddenTitle} className="mt-4">
            {fillNodes(copy.rosterForbiddenBody, {
              capability: <code className="font-mono text-xs">ADMINISTER_STAFF</code>,
            })}
          </InlineAlert>
        )}

        {roster.status === 'loading' && roster.data === null && (
          <SkeletonGroup label={copy.loadingRoster} className="mt-4">
            <div className="space-y-3">
              {[0, 1].map((row) => (
                <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                  <Skeleton height="1rem" width="45%" />
                </div>
              ))}
            </div>
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
          {written && (
            <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
              {written}
            </InlineAlert>
          )}
        </div>

        {roster.status !== 'failed' && roster.data !== null && holders.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.rosterEmptyTitle}
            description={copy.rosterEmptyBody}
          />
        )}

        {roster.status !== 'failed' && roster.data !== null && holders.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {holders.map((holder) => (
              <li
                key={holder.accountId}
                className="rounded-lg border border-fg/8 bg-surface-1 p-4"
              >
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-fg">
                  <EntityName
                    id={holder.accountId}
                    names={names}
                    kind="account"
                    copy={copy.identity}
                    copyable
                  />
                  {holder.accountId === me.data?.accountId && <Tag>{copy.you}</Tag>}
                </p>

                <ul className="mt-3 flex list-none flex-col gap-2">
                  {holder.grants.map((grant) => (
                    <li
                      key={grant.role}
                      className="flex flex-wrap items-center justify-between gap-3 border-t border-fg/8 pt-2"
                    >
                      <div className="min-w-0">
                        <Tag>{copy.role[grant.role]}</Tag>
                        <p className="mt-1 text-xs text-fg-48">
                          {fillNodes(copy.grantedBy, {
                            by: (
                              <EntityName
                                id={grant.grantedBy}
                                names={names}
                                kind="account"
                                copy={copy.identity}
                              />
                            ),
                            date: formatDate(grant.grantedAt, locale),
                          })}
                          {/* The partner grant's note is the service's own bookkeeping. */}
                          {grant.note && grant.role !== 'PARTNER' ? ` — ${grant.note}` : ''}
                        </p>
                      </div>

                      {/*
                        A partner is a role and a profile together, and withdrawing the role
                        alone left a profile whose share still counted against the hundred.
                        The service refuses it now; this says where it is done instead.
                      */}
                      {grant.role === 'PARTNER' ? (
                        <Link
                          href="/admin/partners"
                          className="rounded text-xs text-fg-64 underline underline-offset-4 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                        >
                          {copy.partnerManaged}
                        </Link>
                      ) : (
                        <Pill
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setWithdrawError(null);
                            setWithdrawing(grant);
                          }}
                        >
                          {copy.withdraw}
                        </Pill>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {roster.status !== 'forbidden' && (
        <section aria-labelledby="grant-heading">
          <h2 id="grant-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
            {copy.grantHeading}
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.grantIntro}</p>

          <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-4">
            <AccountPicker
              chosen={account}
              onChoose={setAccount}
              copy={copy.picker}
              disabled={busy}
            />

            {/*
              The role and the note on one line, both labels level: the note's hint used to sit
              inside its field, which lowered the note's label below the role's and left the
              button floating between them.
            */}
            <div className="flex flex-wrap items-end gap-3">
              <Field label={copy.roleLabel} className="min-w-[180px]">
                <Select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
                  {ROLES.map((option) => (
                    <option key={option} value={option}>
                      {copy.role[option]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={copy.noteLabel} className="min-w-[240px] flex-1">
                <TextInput
                  value={note}
                  aria-describedby="staff-grant-note-hint"
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>

              {/*
                Disabled until somebody is chosen, with the reason beside it — #405's rule
                about disabled controls.
              */}
              <Pill
                type="submit"
                variant="outline"
                className="mb-0.5"
                disabled={busy || account === null}
              >
                {busy ? copy.working : copy.grant}
              </Pill>
            </div>
            <p id="staff-grant-note-hint" className="-mt-2 text-xs text-fg-48">
              {copy.noteHint}
              {account === null && <span className="ml-1">{copy.chooseAccountFirst}</span>}
            </p>
          </form>

          <div className="mt-4 rounded-lg border border-fg/8 p-4">
            <p className="text-sm text-fg-64">
              {fillPlaceholders(copy.confers, { role: copy.role[role] })}
            </p>
            {/* What the role confers now, as a super admin last left it, where it is known. */}
            <CapabilityList
              capabilities={
                matrix.data?.roles.find((set) => set.role === role)?.capabilities ??
                ROLE_CAPABILITIES[role]
              }
              copy={copy}
              className="mt-3"
            />
          </div>

          {writeError && (
            <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
              {writeError}
            </InlineAlert>
          )}
        </section>
      )}

      {withdrawing !== null && (
        <Suspense fallback={null}>
          <ConfirmDialog
            title={fillPlaceholders(copy.withdrawTitle, {
              role: copy.role[withdrawing.role],
              name: nameOf(withdrawing.accountId),
            })}
            body={withdrawing.accountId === me.data?.accountId ? copy.withdrawSelfBody : copy.withdrawBody}
            confirmLabel={copy.withdrawConfirm}
            busyLabel={copy.working}
            cancelLabel={copy.cancel}
            busy={busy}
            error={withdrawError}
            onCancel={() => setWithdrawing(null)}
            onConfirm={() => void withdraw(withdrawing)}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * What a set of capabilities lets somebody do, as sentences, with each identifier beside its
 * own. Used for the reader's standing and for what the role in the grant form confers.
 */
function CapabilityList({
  capabilities,
  copy,
  className,
}: {
  readonly capabilities: readonly StaffCapability[];
  readonly copy: StaffRolesCopy;
  readonly className?: string;
}) {
  return (
    <ul className={`grid list-none gap-x-6 gap-y-2 sm:grid-cols-2 ${className ?? ''}`}>
      {capabilities.map((capability) => (
        <li key={capability} className="min-w-0 text-sm text-fg-80">
          {copy.capability[capability] ?? capability}
          <code className="block truncate font-mono text-[11px] text-fg-40">{capability}</code>
        </li>
      ))}
    </ul>
  );
}
