'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { InlineAlert, Switch } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  probeProfileVisibility,
  profileHref,
  setProfileVisibility,
  type ProfileVisibility,
} from '../../lib/profiles/api';
import { useSession } from '../session/SessionProvider';
import type { ProfileVisibilityCopy } from '../../lib/i18n/profile-copy';

/**
 * §4.2's P-07 — whether `/u/{slug}` answers at all. Issue #274.
 *
 * <h2>Why it is on `/settings/privacy` and not on a profile editor</h2>
 *
 * §4.2's note is explicit that P-01 to P-03 have no screen, because there is no `PATCH /v1/me`
 * to save a name or a biography to; an entry pointing at a page that cannot work is worse than
 * no entry. This control has an endpoint of its own and therefore has to live somewhere, and
 * `/settings/privacy` is already the page about who can see what — it holds the data export
 * and the account closure, which are the two other answers to "what does IdeaNest hold about
 * me and who can read it". A `/settings/profile` built to hold one switch would be a screen
 * whose other four fields are the ones that do not exist yet.
 *
 * It sits **above** the export and the closure: those two are read top to bottom as one
 * argument (`app/settings/privacy/page.tsx` explains the order), and inserting a switch
 * between them would break it.
 *
 * <h2>The switch reads its own position from the thing it decides</h2>
 *
 * There is no `GET` for this setting — `GET /v1/me` carries six fields and visibility is not
 * one of them — so the panel asks the public endpoint about the reader's own slug,
 * anonymously, and reads 200 as `PUBLIC` and 404 as `PRIVATE`. `probeProfileVisibility`
 * carries the full argument, including why the request must not send the access token.
 *
 * The alternatives were both worse. Assuming `PUBLIC` because that is the column default
 * would show the wrong position to everybody who has already turned it off — and the first
 * thing they would do is press the switch, which would write the value it already had and
 * leave them believing they had just hidden a profile that was never shown. Offering two
 * buttons and no state asks somebody to make a decision the interface refuses to tell them
 * they have already made.
 *
 * When the probe cannot answer — the service is unreachable, or replies something the
 * contract does not describe — the switch is disabled and says so. **It does not guess.** A
 * control that picks a position and then writes it is a control that overwrites a choice
 * nobody revisited.
 *
 * <h2>The write is confirmed by re-reading, not assumed</h2>
 *
 * `PATCH` answers 204 with no body, so the only evidence the new value took is another probe.
 * The switch moves optimistically because the round trip is two requests and a setting that
 * lags behind the finger feels broken — and it moves **back** if either request refuses, with
 * a sentence saying which position is actually in force. An optimistic switch that cannot
 * revert is a lie with a nice animation.
 *
 * <h2>Motion: 150ms, which is the thumb and nothing else</h2>
 *
 * docs/motion-system.md §5 gives account settings "none — 150ms colour on controls", and
 * `Switch` already animates only its thumb's `transform`. Nothing here enters or fades.
 */

type Probe = ProfileVisibility | 'unknown' | 'loading';

export interface ProfileVisibilityPanelProps {
  /** Every word this panel draws, resolved on the server — #82. */
  readonly copy: ProfileVisibilityCopy;
}

export function ProfileVisibilityPanel({ copy }: ProfileVisibilityPanelProps) {
  const { status, session } = useSession();
  const slug = session?.slug ?? null;

  const [visibility, setVisibility] = useState<Probe>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (slug === null) return;
      const answer = await probeProfileVisibility(slug, signal);
      if (signal?.aborted === true) return;
      setVisibility(answer ?? 'unknown');
    },
    [slug],
  );

  useEffect(() => {
    if (slug === null) return;

    const controller = new AbortController();
    void probe(controller.signal).catch(() => {
      if (!controller.signal.aborted) setVisibility('unknown');
    });
    return () => controller.abort();
  }, [probe, slug]);

  /*
   * Nothing at all until the session is known. `SessionProvider` guards `/settings`, so a
   * signed-out reader is being redirected rather than shown an empty panel, and rendering a
   * disabled switch in the meantime would put a control about somebody's profile on a screen
   * that does not yet know whose profile it is.
   */
  if (status !== 'signed-in' || slug === null) return null;

  async function change(next: boolean): Promise<void> {
    const wanted: ProfileVisibility = next ? 'PUBLIC' : 'PRIVATE';
    const previous = visibility;

    setSaving(true);
    setError(null);
    setVisibility(wanted);

    try {
      await setProfileVisibility(wanted);
      // The endpoint answers 204, so the only confirmation is asking the public one again.
      await probe();
    } catch (cause) {
      setVisibility(previous);
      setError(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? cause.problem?.title ?? copy.refused)
          : copy.unreachable,
      );
    } finally {
      setSaving(false);
    }
  }

  const known = visibility === 'PUBLIC' || visibility === 'PRIVATE';

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{copy.heading}</h2>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">{copy.intro}</p>

      <div className="mt-6">
        <Switch
          checked={visibility === 'PUBLIC'}
          disabled={!known || saving}
          onCheckedChange={(next) => void change(next)}
          label={
            <span className="text-[15px]">
              {copy.toggle}
              {/*
                The state is announced by `role="switch"` itself, so this is the visible half
                only — and it is a word rather than a colour, because colour alone never
                carries meaning (docs/ui-kit.md §9.2).
              */}
              <span aria-hidden="true" className="ml-2 text-white/40">
                {visibility === 'PUBLIC' ? copy.public : visibility === 'PRIVATE' ? copy.hidden : '—'}
              </span>
            </span>
          }
        />
      </div>

      {visibility === 'loading' && (
        <p className="mt-4 text-sm text-white/40">{copy.checking}</p>
      )}

      {visibility === 'unknown' && (
        <div className="mt-5">
          <InlineAlert variant="warning" title={copy.unknownTitle}>
            <p>{copy.unknownBody}</p>
          </InlineAlert>
        </div>
      )}

      {error !== null && (
        <div className="mt-5">
          <InlineAlert variant="danger" title={copy.failedTitle} onDismiss={() => setError(null)}>
            <p>{error}</p>
          </InlineAlert>
        </div>
      )}

      {visibility === 'PUBLIC' && (
        <p className="mt-5 text-sm text-white/40">
          <Link
            href={profileHref(slug)}
            className="rounded-sm text-white/64 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {copy.seeAsVisitor}
          </Link>
        </p>
      )}
    </section>
  );
}
