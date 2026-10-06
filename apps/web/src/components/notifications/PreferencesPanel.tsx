'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineAlert, Pill, Select, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { CATEGORIES, CHANNELS, modesFor } from '@ideanest/account/notifications';
import { ApiError } from '../../lib/api/problem';
import type { PreferencesCopy } from '../../lib/i18n/notifications-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import {
  listPreferences,
  updatePreferences,
  type DeliveryMode,
  type NotificationCategory,
  type NotificationChannel,
  type PreferenceSwitch,
} from '../../lib/notifications/api';
import {
  categoryDescription,
  categoryLabel,
  channelLabel,
  mandatoryReason,
  modeLabel,
} from '@ideanest/account/inbox';

type Status = 'loading' | 'ready' | 'failed' | 'signed-out';

/** A key that identifies one switch. */
function keyOf(category: NotificationCategory, channel: NotificationChannel): string {
  return `${category}:${channel}`;
}

function messageFor(cause: unknown, copy: PreferencesCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 429) {
      return copy.tooManyChanges;
    }
    if (cause.status === 409) {
      return copy.conflict;
    }
    return (
      cause.problem?.detail ?? cause.problem?.title ?? copy.refused
    );
  }
  return copy.unreachable;
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * Per-category, per-channel delivery control — §4.10 and #89.
 *
 * <h2>Every switch is drawn from the response, and none of §4.10's rules is restated here</h2>
 *
 * `GET /v1/me/notification-preferences` answers the whole page resolved through the same
 * policy the fan-out uses, and each row says whether it is `changeable` and whether a
 * digest is `digestOffered`. This component asks those two questions rather than deciding
 * them: a client that knew which categories are mandatory would drift from the service the
 * first time §4.10 changed, and the drift would show as a switch somebody could move that
 * the service then refused.
 *
 * The common case is an account with nothing stored at all, which is why the response is
 * every switch rather than the table — and why a default is labelled as a default here
 * instead of looking like a choice somebody made.
 *
 * <h2>One switch, one request</h2>
 *
 * The `PATCH` takes a list and could carry the whole grid, but a settings page that saved
 * on a button would have to decide what to do about the switches that were refused — and
 * the endpoint is all-or-nothing, so one refusal discards the rest. Saving each change as
 * it is made keeps the failure where the person can see it: the control that would not move
 * goes back to what it was, and everything else stays.
 *
 * The service answers with the whole page either way, so the response is adopted wholesale
 * rather than merged — a change can move something the caller did not send.
 *
 * MOTION IS NEAR ZERO, as on the device list beside it: settings is work, not discovery.
 */
export interface PreferencesPanelProps {
  /** Every word this panel draws — see `lib/i18n/notifications-copy.ts`. */
  readonly copy: PreferencesCopy;
}

export function PreferencesPanel({ copy }: PreferencesPanelProps) {
  /* The language, for the two labels the announcement lowercases. See `change` below. */
  const locale = useRouteLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [preferences, setPreferences] = useState<readonly PreferenceSwitch[]>([]);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const page = await listPreferences(signal);
      if (signal?.aborted) return;

      setPreferences(page);
      setError(null);
      setStatus('ready');
    } catch (cause) {
      if (signal?.aborted || wasAborted(cause)) return;

      if (cause instanceof ApiError && cause.status === 401) {
        setStatus('signed-out');
        return;
      }
      setError(messageFor(cause, copy));
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function markBusy(key: string, busy: boolean): void {
    setBusyKeys((previous) => {
      const next = new Set(previous);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function change(
    preference: PreferenceSwitch,
    mode: DeliveryMode,
  ): Promise<void> {
    const key = keyOf(preference.category, preference.channel);
    markBusy(key, true);
    setError(null);
    setNotice(null);

    try {
      const page = await updatePreferences([
        { category: preference.category, channel: preference.channel, mode },
      ]);
      setPreferences(page);
      setNotice(
        fillPlaceholders(copy.saved, {
          category: categoryLabel(preference.category, copy),
          /*
           * `toLocaleLowerCase` and not `toLowerCase` — #324. The capital I lowercases to a
           * dotless ı in Turkish unless the locale is passed, so "In app" would announce with
           * a letter the language does not use there.
           */
          channel: channelLabel(preference.channel, copy).toLocaleLowerCase(locale),
          mode: modeLabel(mode, copy).toLocaleLowerCase(locale),
        }),
      );
    } catch (cause) {
      // Nothing is written back, so the control re-renders from `preferences` — which
      // still holds what the service last confirmed. The switch visibly returns to where
      // it was, which is the truthful thing for it to do.
      setError(messageFor(cause, copy));
    } finally {
      markBusy(key, false);
    }
  }

  if (status === 'signed-out') {
    return (
      <InlineAlert variant="info" title={copy.signedOut}>
        {copy.signedOutBody}
      </InlineAlert>
    );
  }

  const stored = preferences.filter((preference) => preference.stored).length;

  return (
    <section aria-labelledby="preferences-heading">
      <h2
        id="preferences-heading"
        tabIndex={-1}
        ref={headingRef}
        className="text-lg font-medium tracking-[-0.02em] text-white"
      >
        {copy.heading}
        {status === 'ready' && stored === 0 && (
          <span className="ml-2 text-xs font-normal text-white/40">{copy.defaults}</span>
        )}
      </h2>

      {/*
        Registered on the first render so the region exists before anything is put in it —
        a live region created and filled in the same commit is not reliably announced.
      */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && (
          <InlineAlert variant="success" className="mt-4">
            {fillPlaceholders(copy.savedNotice, { change: notice })}
          </InlineAlert>
        )}
      </div>

      {error && (
        <InlineAlert variant="danger" title={copy.saveFailedTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {status === 'loading' && (
        <SkeletonGroup label={copy.loading} className="mt-4">
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-2 px-5 py-4">
                <Skeleton height="1rem" width="30%" />
                <div className="mt-3 flex gap-3">
                  <Skeleton height="2.25rem" width="10rem" />
                  <Skeleton height="2.25rem" width="10rem" />
                  <Skeleton height="2.25rem" width="10rem" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && (
        <div className="mt-4 space-y-3">
          {CATEGORIES.map((category) => {
            const row = preferences.filter((preference) => preference.category === category);
            if (row.length === 0) return null;

            return (
              <div
                key={category}
                className="rounded-lg border border-white/8 bg-surface-2 px-5 py-4"
              >
                <h3 className="text-sm font-medium text-white">{categoryLabel(category, copy)}</h3>
                <p className="mt-1 max-w-[60ch] text-xs text-white/56">
                  {categoryDescription(category, copy)}
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {CHANNELS.map((channel) => {
                    const preference = row.find((entry) => entry.channel === channel);
                    if (preference === undefined) return null;

                    const key = keyOf(category, channel);
                    const controlId = `pref-${key.toLowerCase().replace(':', '-')}`;

                    return (
                      <div key={channel}>
                        <label
                          htmlFor={controlId}
                          className="mb-1 block text-xs font-medium text-white/72"
                        >
                          {channelLabel(channel, copy)}
                        </label>
                        <Select
                          id={controlId}
                          size="sm"
                          value={preference.mode}
                          disabled={!preference.changeable || busyKeys.has(key)}
                          onChange={(event) =>
                            void change(preference, event.target.value as DeliveryMode)
                          }
                        >
                          {modesFor(preference.digestOffered).map((mode) => (
                            <option key={mode} value={mode}>
                              {modeLabel(mode, copy)}
                            </option>
                          ))}
                        </Select>
                        {/*
                          A disabled control with no explanation is a control that looks
                          broken. §4.10 makes a security alert mandatory on purpose, and
                          somebody who cannot silence it is owed the reason rather than a
                          greyed-out box -- which is also why the service sends
                          `changeable` instead of leaving the switch out.
                        */}
                        {!preference.changeable && (
                          <p className="mt-1 text-[0.6875rem] text-white/56">
                            {mandatoryReason(category, copy)}
                          </p>
                        )}
                        {preference.changeable && !preference.stored && (
                          <p className="mt-1 text-[0.6875rem] text-white/40">{copy.default}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => void load()}>
          {copy.tryAgain}
        </Pill>
      )}
    </section>
  );
}
