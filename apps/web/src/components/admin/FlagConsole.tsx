'use client';

import { useId, useState } from 'react';
import {
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Switch,
  TextInput,
} from '@ideanest/ui';
import type { AdminUser } from '../../lib/admin/api';
import { bakuDateTime } from '../../lib/admin/console-dates';
import { codedRefusalFor, refusalCode } from '../../lib/admin/coded-refusal';
import type { DirectoryNames } from '../../lib/admin/directory';
import {
  FLAG_KEY_PATTERN,
  MAX_DESCRIPTION,
  MAX_ENABLED_ACCOUNTS,
  ROLLOUT_STEPS,
  createFlag,
  reachOf,
  readFlags,
  saveFlag,
  widensReach,
  type FeatureFlag,
  type FeatureFlagList,
  type FlagState,
} from '../../lib/admin/flags';
import { actionMessageFor, shortId } from '../../lib/admin/refusals';
import { ApiError } from '../../lib/api/problem';
import { numberFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { FlagConsoleCopy } from '../../lib/i18n/admin/platform-copy';
import { AccountPicker } from './AccountPicker';
import { Confirm } from './ConsoleConfirm';
import { useConsoleMembership } from './ConsoleMembership';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * §4.11's AD-12: gradual rollout and experiments — issue #312.
 *
 * <h2>It says that nothing reads these yet</h2>
 *
 * Flags are answered by `GET /v1/feature-flags` and no product feature asks it yet. A switch on
 * this screen therefore changes the platform's answer and nothing else, and the screen says so
 * at the top rather than promising a kill switch for features that are not behind one.
 *
 * <h2>Widening asks, narrowing does not</h2>
 *
 * Switching a flag on, raising its percentage, or naming another account shows a feature to
 * people, and asks first. Switching it off, lowering it, or taking an account out is one press:
 * that is what somebody reaches for when a feature misbehaves.
 *
 * <h2>Every save is made from the version on the screen</h2>
 *
 * A save refused because somebody else saved first reloads the list and says why in the row, so
 * the reader decides again from what is there now rather than overwriting it.
 *
 * <h2>There is no delete</h2>
 *
 * Code asking for a flag that no longer exists gets the fail-closed default silently, so a
 * deleted row and a row that never existed are indistinguishable from the application&apos;s
 * side. A flag is switched off instead, which leaves the row saying who switched it off.
 */
export interface FlagConsoleProps {
  readonly copy: FlagConsoleCopy;
}

export function FlagConsole({ copy }: FlagConsoleProps) {
  const locale = useRouteLocale();
  const { membership } = useConsoleMembership();
  const flags = useConsoleResource((signal) => readFlags(signal), copy.subject, copy.refusals, []);
  const list = flags.data?.flags ?? [];
  const names = useDirectoryNames(
    list.flatMap((flag) => [flag.updatedBy, ...flag.enabledAccounts]),
    [],
  );
  // Searching the directory is `GET /v1/admin/users`, which needs this. Without it the names
  // are still shown — the directory lookup needs nothing — but cannot be changed here.
  const canPickAccounts = membership?.capabilities.includes('ADMINISTER_ACCOUNTS') ?? false;

  if (flags.status === 'signed-out' || flags.status === 'forbidden') {
    return <ConsoleRefusal status={flags.status} capability={flags.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  /** One saved flag replaces its row, so nothing else on the screen moves. */
  function replace(saved: FeatureFlag): void {
    const current: FeatureFlagList = flags.data ?? { flags: [] };
    const others = current.flags.filter((flag) => flag.key !== saved.key);
    flags.set({ flags: [...others, saved].sort((a, b) => a.key.localeCompare(b.key)) });
  }

  return (
    <div className="flex flex-col gap-10">
      <InlineAlert variant="info" title={copy.notReadTitle}>
        {copy.notReadBody}
      </InlineAlert>

      <section aria-labelledby="flags-heading">
        <h2 id="flags-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.heading}
          {flags.data !== null && (
            <span className="ml-2 text-xs font-normal text-white/48">{list.length}</span>
          )}
        </h2>

        {flags.data === null && flags.status === 'loading' && (
          <SkeletonGroup label={copy.loadingList} className="mt-4">
            <div className="space-y-3">
              {[0, 1].map((row) => (
                <div key={row} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                  <Skeleton height="1rem" width="35%" />
                  <Skeleton height="0.875rem" width="65%" className="mt-3" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        )}

        {flags.status === 'failed' && (
          <>
            <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
              {flags.error}
            </InlineAlert>
            <Pill variant="ghost" size="sm" className="mt-4" onClick={flags.reload}>
              {copy.tryAgain}
            </Pill>
          </>
        )}

        {flags.data !== null && list.length === 0 && (
          <EmptyState className="mt-4" variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />
        )}

        {list.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {list.map((flag) => (
              <FlagRow
                key={flag.key}
                flag={flag}
                copy={copy}
                locale={locale}
                names={names}
                canPickAccounts={canPickAccounts}
                onSaved={replace}
                onStale={flags.reload}
              />
            ))}
          </ul>
        )}
      </section>

      <AddFlag copy={copy} onCreated={replace} />
    </div>
  );
}

/** A refusal in the screen's words, by its code; the service's English never reaches the reader. */
function refusalFor(cause: unknown, copy: FlagConsoleCopy): string {
  const code = refusalCode(cause);
  if (code !== undefined && Object.hasOwn(copy.errors, code)) return copy.errors[code] ?? copy.refusals.refused;
  // A refused write names the act and the capability it needs, not "reading the flags".
  if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
    return actionMessageFor(cause, copy.subject, copy.refusals);
  }
  return codedRefusalFor(cause, copy.errors, copy.refusals.invalidRequest ?? copy.refusals.refused, copy.subject, copy.refusals);
}

function percentOf(value: number, locale: Locale): string {
  return numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }, 'flag-rollout').format(value / 100);
}

function reachSentence(state: FlagState, copy: FlagConsoleCopy, locale: Locale): string {
  return fillPlaceholders(copy.reach[reachOf(state)] ?? '', { percent: percentOf(state.rolloutPercentage, locale) });
}

function stateOf(flag: FeatureFlag): FlagState {
  return {
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    rolloutPercentage: flag.rolloutPercentage,
    enabledAccounts: flag.enabledAccounts,
  };
}

interface FlagRowProps {
  readonly flag: FeatureFlag;
  readonly copy: FlagConsoleCopy;
  readonly locale: Locale;
  readonly names: DirectoryNames;
  readonly canPickAccounts: boolean;
  readonly onSaved: (saved: FeatureFlag) => void;
  readonly onStale: () => void;
}

function FlagRow({ flag, copy, locale, names, canPickAccounts, onSaved, onStale }: FlagRowProps) {
  const nameId = useId();
  const accountsId = useId();
  const current = stateOf(flag);

  const [pending, setPending] = useState<FlagState | null>(null);
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(flag.description);
  const [draftError, setDraftError] = useState(false);

  const accountName = (id: string) => names.accounts.get(id)?.name ?? shortId(id);

  /** A change that widens who sees the flag asks first; anything else is saved at once. */
  function change(next: FlagState): void {
    setError(null);
    if (widensReach(current, next)) {
      setPending(next);
      return;
    }
    void commit(next);
  }

  async function commit(next: FlagState): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveFlag(next, flag.version));
      setPending(null);
      setPicked(null);
      setEditing(false);
    } catch (cause) {
      setError(refusalFor(cause, copy));
      setPending(null);
      setPicked(null);
      // The list is behind the service: read it again, so the next decision is made from
      // what is there now. The row stays, so the sentence saying why stays with it.
      const code = refusalCode(cause);
      if (code === 'FEATURE_FLAG_CHANGED' || code === 'FEATURE_FLAG_NOT_FOUND') onStale();
    } finally {
      setBusy(false);
    }
  }

  function pick(account: AdminUser | null): void {
    if (account === null) {
      // "Choose somebody else" while the addition is waiting to be confirmed withdraws it.
      setPicked(null);
      setPending(null);
      return;
    }
    if (current.enabledAccounts.includes(account.id)) return;
    setPicked(account);
    change({ ...current, enabledAccounts: [...current.enabledAccounts, account.id] });
  }

  const full = current.enabledAccounts.length >= MAX_ENABLED_ACCOUNTS;

  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={nameId} className="font-mono text-sm text-white">
            {flag.key}
          </p>
          {!editing && <p className="mt-1 whitespace-pre-line text-xs text-white/64">{flag.description}</p>}
        </div>

        {/* Named by the flag, so a screen reader hears "checkout-v2, switch, on". */}
        <Switch
          checked={flag.enabled}
          disabled={busy || pending !== null}
          aria-labelledby={nameId}
          label={flag.enabled ? copy.on : copy.off}
          onCheckedChange={(next) => change({ ...current, enabled: next })}
        />
      </div>

      {editing ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text === '') {
              setDraftError(true);
              return;
            }
            change({ ...current, description: text });
          }}
        >
          <Field label={copy.switchesLabel} error={draftError ? copy.descriptionRequired : undefined}>
            <TextInput
              value={draft}
              maxLength={MAX_DESCRIPTION}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftError(false);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Pill type="submit" variant="outline" size="sm" disabled={busy}>
              {busy ? copy.working : copy.saveDescription}
            </Pill>
            <Pill
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(flag.description);
                setDraftError(false);
              }}
            >
              {copy.cancel}
            </Pill>
          </div>
        </form>
      ) : (
        <Pill
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={busy || pending !== null}
          onClick={() => {
            setDraft(flag.description);
            setEditing(true);
          }}
        >
          {copy.editDescription}
        </Pill>
      )}

      <p className="mt-3 text-sm text-white/80">{reachSentence(current, copy, locale)}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/64">
          {fillPlaceholders(copy.rolloutNow, { percent: percentOf(flag.rolloutPercentage, locale) })}
        </span>
        <div
          role="group"
          aria-label={fillPlaceholders(copy.rolloutGroup, { flag: flag.key })}
          className="flex flex-wrap gap-2"
        >
          {ROLLOUT_STEPS.map((percentage) => {
            const pressed = flag.rolloutPercentage === percentage;
            return (
              <Pill
                key={percentage}
                variant={pressed ? 'outline' : 'ghost'}
                size="sm"
                aria-pressed={pressed}
                disabled={busy || pending !== null}
                onClick={() => (pressed ? undefined : change({ ...current, rolloutPercentage: percentage }))}
              >
                {percentOf(percentage, locale)}
              </Pill>
            );
          })}
        </div>
      </div>

      <div className="mt-4" role="group" aria-labelledby={accountsId}>
        <p id={accountsId} className="text-xs text-white/64">
          {copy.accountsHeading}
        </p>
        {current.enabledAccounts.length === 0 ? (
          <p className="mt-1 text-xs text-white/48">{copy.accountsNone}</p>
        ) : (
          <ul className="mt-2 flex list-none flex-wrap gap-2">
            {current.enabledAccounts.map((account) => (
              <li
                key={account}
                className="flex items-center gap-2 rounded-full border border-white/8 py-1 pl-3 pr-1 text-xs text-white"
              >
                <span title={account}>{accountName(account)}</span>
                {canPickAccounts && (
                  <Pill
                    variant="ghost"
                    size="sm"
                    disabled={busy || pending !== null}
                    aria-label={fillPlaceholders(copy.removeAccountLabel, { name: accountName(account), flag: flag.key })}
                    onClick={() =>
                      change({ ...current, enabledAccounts: current.enabledAccounts.filter((id) => id !== account) })
                    }
                  >
                    {copy.removeAccount}
                  </Pill>
                )}
              </li>
            ))}
          </ul>
        )}

        {canPickAccounts ? (
          full ? (
            <p className="mt-2 text-xs text-white/48">{copy.accountsFull}</p>
          ) : (
            <AccountPicker
              className="mt-3 max-w-[480px]"
              chosen={picked}
              onChoose={pick}
              copy={copy.picker}
              disabled={busy || (pending !== null && picked === null)}
            />
          )
        ) : (
          <p className="mt-2 text-xs text-white/48">{copy.accountsReadOnly}</p>
        )}
      </div>

      {pending !== null && (
        <div className="mt-4">
          <Confirm
            label={fillPlaceholders(copy.confirmLabel, { flag: flag.key })}
            text={fillPlaceholders(copy.confirmWiden, { flag: flag.key, reach: reachSentence(pending, copy, locale) })}
            action={copy.confirmYes}
            working={copy.working}
            back={copy.keep}
            busy={busy}
            onConfirm={() => void commit(pending)}
            onBack={() => {
              setPending(null);
              setPicked(null);
            }}
          />
        </div>
      )}

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {flag.updatedAt !== '' && (
        <p className="mt-3 text-xs text-white/48">
          {fillPlaceholders(copy.lastChanged, {
            date: bakuDateTime(flag.updatedAt, locale),
            name: accountName(flag.updatedBy),
          })}
        </p>
      )}
    </li>
  );
}

function AddFlag({ copy, onCreated }: { readonly copy: FlagConsoleCopy; readonly onCreated: (flag: FeatureFlag) => void }) {
  const nameHintId = useId();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const name = key.trim();
  const nameIsValid = FLAG_KEY_PATTERN.test(name);
  // Wrong as soon as something has been typed, or when an empty name was submitted.
  const showNameError = (name !== '' || tried) && !nameIsValid;
  const showDescriptionError = tried && description.trim() === '';

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setTried(true);
    setNotice(null);
    if (!nameIsValid || description.trim() === '') return;

    setBusy(true);
    setError(null);
    try {
      const created = await createFlag(name, description.trim());
      onCreated(created);
      setKey('');
      setDescription('');
      setTried(false);
      setNotice(fillPlaceholders(copy.created, { flag: created.key }));
    } catch (cause) {
      setError(refusalFor(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-flag-heading">
      <h2 id="new-flag-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
        {copy.addHeading}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.addIntro}</p>

      {/*
        Stacked rather than a row with the button at its end: a hint or an error under one field
        pushed that field's input down, and the button aligned to the row's end hung beside the
        hint instead of the input.
      */}
      <form noValidate onSubmit={(event) => void create(event)} className="mt-4 flex max-w-[640px] flex-col gap-4">
        <Field label={copy.nameLabel} error={showNameError ? copy.nameError : undefined} required>
          <TextInput
            value={key}
            aria-describedby={nameHintId}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
            /* An example flag name rather than a sentence: it is the shape the service's
               `CHECK` accepts, and it reads the same in every language. */
            placeholder="checkout-v2"
          />
        </Field>
        <p id={nameHintId} className="-mt-2 text-xs text-white/48">
          {copy.nameHint}
        </p>

        <Field label={copy.switchesLabel} error={showDescriptionError ? copy.descriptionRequired : undefined} required>
          <TextInput value={description} onChange={(event) => setDescription(event.target.value)} maxLength={MAX_DESCRIPTION} />
        </Field>

        <div>
          <Pill type="submit" variant="outline" size="sm" disabled={busy}>
            {busy ? copy.working : copy.add}
          </Pill>
        </div>
      </form>

      {error !== null && (
        <InlineAlert variant="danger" title={copy.failedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
      {notice !== null && (
        <InlineAlert variant="success" title={copy.doneTitle} className="mt-4">
          {notice}
        </InlineAlert>
      )}
    </section>
  );
}
