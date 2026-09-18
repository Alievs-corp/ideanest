'use client';

import { useState } from 'react';
import { EmptyState, Field, InlineAlert, Pill, Select, Skeleton, SkeletonGroup, Tag, TextInput } from '@ideanest/ui';
import {
  ROLE_CAPABILITIES,
  grantRole,
  readMembership,
  readRoster,
  revokeRole,
  type StaffGrant,
  type StaffRole,
} from '../../lib/admin/staff';
import type { AdminUser } from '../../lib/admin/api';
import { consoleMessageFor } from '../../lib/admin/refusals';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import type { StaffRolesCopy } from '../../lib/i18n/admin/people-copy';
import { AccountPicker } from './AccountPicker';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/*
 * The five the service has, in its own order. `COMPLIANCE` was missing, so the one role that
 * can open an identity document was the one role no administrator could grant from this
 * screen — the grant existed at `PUT /v1/admin/staff/{id}/roles/COMPLIANCE` and the only way
 * to reach it was curl.
 */
const ROLES: readonly StaffRole[] = [
  'MODERATOR',
  'CURATOR',
  'FINANCE',
  'COMPLIANCE',
  'ADMINISTRATOR',
];

/**
 * §4.11's role model, as a screen — issue #295.
 *
 * <h2>What was here before</h2>
 *
 * Nothing, and there could not have been. Staff identity was one comma-separated
 * environment variable, so "who works here" had no answer the platform could render and no
 * answer anybody could change without a deployment. #295's own words for the problem: that
 * list "cannot express 'may refund' against 'may moderate'".
 *
 * <h2>Two panels, and the first one is about the reader</h2>
 *
 * The console now knows what the person reading it may do, so the first thing this screen
 * shows is that — every capability they hold and the roles it came from. That is not
 * decoration: the commonest question a member of staff has about a console is why a screen
 * they were told about is not on their rail, and this answers it without anybody having to
 * ask an administrator.
 *
 * <h2>Bootstrapped administrators are called out</h2>
 *
 * An account that is staff through `IDEANEST_STAFF_BOOTSTRAP_EMAILS` rather than through a
 * grant cannot be withdrawn from this screen — it is in a deployment's environment, and the
 * only way to remove it is to change that and restart. A roster that showed them as ordinary
 * administrators would be a list somebody would try to revoke from and quietly fail.
 *
 * <h2>Everybody on it has a name — issue #402</h2>
 *
 * <p>This screen told the person reading it that they were signed in as `c5c5493d`, on a
 * session whose site header renders their name three centimetres above. The roster listed
 * grants by fragment, so "who may move money on this platform" could not be answered by
 * reading the screen that decides it. Both are resolved through the console directory now,
 * and the fragment stays beside each name because that is what somebody quotes to an
 * engineer.
 *
 * <p><strong>And the grant form no longer asks for something it cannot supply.</strong> It
 * used to take a full UUID with the help text "from the account directory", and the account
 * directory rendered no identifier anywhere — so the one privileged action on this screen
 * could not be completed inside the console at all. {@link AccountPicker} is the fix, and
 * carries the argument for why this field gets a picker and the console's other five do not.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives an administrative surface 150ms of colour on a control and
 * nothing that moves. This one changes who can move money; it is the last screen on the
 * platform that should feel playful.
 */
export interface StaffRolesProps {
  readonly copy: StaffRolesCopy;
}

export function StaffRoles({ copy }: StaffRolesProps) {
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

  const [account, setAccount] = useState<AdminUser | null>(null);
  const [role, setRole] = useState<StaffRole>('MODERATOR');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [written, setWritten] = useState<string | null>(null);

  /*
   * Everybody this screen mentions: the reader, whoever holds a grant, and whoever made
   * it. Named through the console directory since #402 — the fragments this used to render
   * are still beside each name, because a fragment is what gets quoted and a name is what
   * gets recognised.
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
      setWriteError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(grant: StaffGrant): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setWritten(null);
    try {
      await revokeRole(grant.accountId, grant.role);
      setWritten(
        fillPlaceholders(copy.withdrawnNotice, {
          role: copy.role[grant.role],
          name: names.accounts.get(grant.accountId)?.name ?? grant.accountId,
        }),
      );
      roster.reload();
    } catch (cause) {
      setWriteError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="my-standing-heading">
        <h2 id="my-standing-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.myHeading}
        </h2>

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
          <div className="mt-4 rounded-lg border border-white/8 bg-surface-1 p-4">
            <p className="text-sm text-white/64">
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

            <ul className="mt-4 flex list-none flex-wrap gap-2">
              {me.data.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="rounded-md border border-white/8 px-2.5 py-1.5 text-xs text-white/64"
                  title={copy.capability[capability]}
                >
                  {capability}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="roster-heading">
        <h2 id="roster-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.rosterHeading}
        </h2>

        {roster.status === 'forbidden' && (
          <InlineAlert variant="info" title={copy.rosterForbiddenTitle} className="mt-4">
            {fillNodes(copy.rosterForbiddenBody, {
              capability: <code className="font-mono text-xs">ADMINISTER_STAFF</code>,
            })}
          </InlineAlert>
        )}

        {roster.status === 'loading' && (
          <SkeletonGroup label={copy.loadingRoster} className="mt-4">
            <div className="space-y-3">
              {[0, 1].map((row) => (
                <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
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

        {roster.status === 'ready' && roster.data !== null && roster.data.grants.length === 0 && (
          <EmptyState
            className="mt-4"
            variant="empty"
            title={copy.rosterEmptyTitle}
            description={copy.rosterEmptyBody}
          />
        )}

        {roster.status === 'ready' && roster.data !== null && roster.data.grants.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {roster.data.grants.map((grant) => (
              <li
                key={`${grant.accountId}:${grant.role}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-surface-1 p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white">
                    <EntityName
                      id={grant.accountId}
                      names={names}
                      kind="account"
                      copy={copy.identity}
                      copyable
                    />{' '}
                    <Tag className="ml-1">{copy.role[grant.role]}</Tag>
                  </p>
                  <p className="mt-1 text-xs text-white/48">
                    {fillNodes(copy.grantedBy, {
                      by: (
                        <EntityName
                          id={grant.grantedBy}
                          names={names}
                          kind="account"
                          copy={copy.identity}
                        />
                      ),
                      date: new Date(grant.grantedAt).toISOString().slice(0, 10),
                    })}
                    {grant.note ? ` — ${grant.note}` : ''}
                  </p>
                </div>

                <Pill variant="ghost" size="sm" disabled={busy} onClick={() => void withdraw(grant)}>
                  {copy.withdraw}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      {roster.status !== 'forbidden' && (
        <section aria-labelledby="grant-heading">
          <h2 id="grant-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
            {copy.grantHeading}
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.grantIntro}</p>

          <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-4">
            {/*
              The picker, not a UUID field. #402: the identifier this asked for was not
              obtainable from the screen its own help text named, so the grant could not be
              completed inside the console. `AccountPicker` says why this field gets a
              picker and the console's other five keep a text input.
            */}
            <AccountPicker
              chosen={account}
              onChoose={setAccount}
              copy={copy.picker}
              disabled={busy}
            />

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

            <Field label={copy.noteLabel} hint={copy.noteHint} className="min-w-[240px] flex-1">
              <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>

            {/*
              Disabled until somebody is chosen, with the reason beside it — #405's rule
              about disabled controls applies to this screen too, and "Grant" with nobody
              to grant to is a control offering an action the reader cannot take.
            */}
            <Pill
              type="submit"
              variant="outline"
              size="sm"
              className="mb-1"
              disabled={busy || account === null}
            >
              {busy ? copy.working : copy.grant}
            </Pill>
            {account === null && (
              <p className="mb-2 text-xs text-white/48">{copy.chooseAccountFirst}</p>
            )}
            </div>
          </form>

          <p className="mt-3 text-xs text-white/48">
            {/*
              The capabilities are their own identifiers, not the sentences beside them: this
              is the list somebody quotes when asking for a role, and the service names the
              same strings back in a refusal.
            */}
            {fillPlaceholders(copy.confers, {
              role: copy.role[role],
              capabilities: ROLE_CAPABILITIES[role].join(', '),
            })}
          </p>

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
      )}
    </div>
  );
}
