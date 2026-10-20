'use client';

import { useState } from 'react';
import { Checkbox, Chip, ChipRow, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { pagesOpenedBy } from '../../lib/admin/navigation';
import { consoleMessageFor } from '../../lib/admin/refusals';
import {
  changeRoleCapabilities,
  type RoleCapabilityMatrix,
  type RoleCapabilitySet,
  type StaffCapability,
  type StaffRole,
} from '../../lib/admin/staff';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { StaffRolesCopy } from '../../lib/i18n/admin/people-copy';
import type { ConsoleResource } from './useConsoleResource';

/**
 * What each staff role may do, changed by a super admin — V114.
 *
 * <h2>Capabilities, shown as the pages they open</h2>
 *
 * <p>The service authorises by capability, not by page, and several pages share one —
 * `CONFIGURE_PLATFORM` is fees, plans, flags, email copy and maintenance. A checkbox per page
 * would promise a separation the server does not make: switching off "Plans" alone would leave
 * every plan endpoint open to whoever still held the capability behind it. So a checkbox is a
 * capability, and under it are the pages it opens, from `pagesOpenedBy` — the rail's own table,
 * so the two cannot disagree.
 *
 * <h2>The server decides what is offered</h2>
 *
 * <p>The checkboxes are the role's `adjustable` list from `GET /v1/admin/roles`, not a copy of the
 * rule. Staff administration and partner statistics are never in it, and super admin and partner
 * are not roles the service returns at all; the endpoint refuses them if asked regardless.
 *
 * <h2>Drafts per role</h2>
 *
 * <p>Switching role keeps what was ticked on the one left, so comparing two roles does not lose an
 * edit. Save writes the role on screen only, and a role with unsaved changes says so beside the
 * buttons.
 *
 * <h2>Motion: none</h2>
 *
 * <p>docs/motion-system.md §5 gives the console none beyond 150ms of colour on a control.
 */
export interface RoleCapabilityEditorProps {
  readonly matrix: ConsoleResource<RoleCapabilityMatrix | null>;
  readonly copy: StaffRolesCopy;
}

export function RoleCapabilityEditor({ matrix, copy }: RoleCapabilityEditorProps) {
  const words = copy.editor;
  const roles = matrix.data?.roles ?? [];

  const [selected, setSelected] = useState<StaffRole | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<StaffRole, readonly StaffCapability[]>>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (matrix.status === 'loading' && matrix.data === null) {
    return (
      <SkeletonGroup label={words.loading} className="mt-4">
        <Skeleton height="2rem" width="60%" />
        <Skeleton height="1rem" width="80%" className="mt-4" />
        <Skeleton height="1rem" width="70%" className="mt-3" />
      </SkeletonGroup>
    );
  }

  if (matrix.status !== 'ready' || matrix.data === null) {
    return (
      <>
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {matrix.error}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={matrix.reload}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  const current: RoleCapabilitySet | undefined =
    roles.find((set) => set.role === selected) ?? roles[0];
  if (current === undefined) return null;

  const ticked = drafts[current.role] ?? current.capabilities;
  const dirty = !sameSet(ticked, current.capabilities);
  const atDefault = sameSet(ticked, current.defaults);

  function choose(role: StaffRole): void {
    setSelected(role);
    setSaved(null);
    setFailure(null);
  }

  function toggle(capability: StaffCapability, on: boolean): void {
    if (current === undefined) return;
    const next = on ? [...ticked, capability] : ticked.filter((held) => held !== capability);
    setDrafts((all) => ({ ...all, [current.role]: next }));
    setSaved(null);
  }

  async function save(): Promise<void> {
    if (current === undefined) return;
    setBusy(true);
    setSaved(null);
    setFailure(null);
    try {
      const result = await changeRoleCapabilities(current.role, ticked);
      matrix.set({
        roles: roles.map((set) => (set.role === result.role ? result : set)),
      });
      setDrafts((all) => {
        const rest = { ...all };
        delete rest[result.role];
        return rest;
      });
      setSaved(fillPlaceholders(words.saved, { role: copy.role[result.role] }));
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      setFailure(
        code != null && copy.errors[code] !== undefined
          ? copy.errors[code]
          : consoleMessageFor(cause, words.subject, copy.refusals),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <ChipRow aria-label={copy.roleLabel}>
        {roles.map((set) => (
          <Chip key={set.role} active={set.role === current.role} onClick={() => choose(set.role)}>
            {copy.role[set.role]}
          </Chip>
        ))}
      </ChipRow>

      <div className="mt-4 rounded-lg border border-white/8 bg-surface-1 p-4 sm:p-5">
        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="sr-only">{copy.role[current.role]}</legend>
          {current.adjustable.map((capability) => {
            const pages = pagesOpenedBy(capability).map((link) => words.links[link] ?? link);
            const changed = ticked.includes(capability) !== current.defaults.includes(capability);
            return (
              <Checkbox
                key={capability}
                label={copy.capability[capability] ?? capability}
                checked={ticked.includes(capability)}
                disabled={busy}
                onChange={(event) => toggle(capability, event.target.checked)}
                description={
                  <>
                    <span className="block">
                      {pages.length > 0
                        ? fillPlaceholders(words.pages, { pages: pages.join(', ') })
                        : words.noPages}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono text-[11px] text-white/40">{capability}</code>
                      {changed && <span className="text-xs text-white/64">· {words.changed}</span>}
                    </span>
                  </>
                }
              />
            );
          })}
        </fieldset>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/8 pt-4">
          <Pill variant="outline" size="sm" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? words.saving : words.save}
          </Pill>
          <Pill
            variant="ghost"
            size="sm"
            disabled={busy || atDefault}
            onClick={() => {
              setDrafts((all) => ({ ...all, [current.role]: current.defaults }));
              setSaved(null);
            }}
          >
            {words.reset}
          </Pill>
          {dirty && <span className="text-xs text-white/64">{words.unsaved}</span>}
        </div>
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {saved !== null && (
          <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
            {saved}
          </InlineAlert>
        )}
      </div>
      {failure !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {failure}
        </InlineAlert>
      )}
    </div>
  );
}

function sameSet(a: readonly StaffCapability[], b: readonly StaffCapability[]): boolean {
  return a.length === b.length && a.every((capability) => b.includes(capability));
}
