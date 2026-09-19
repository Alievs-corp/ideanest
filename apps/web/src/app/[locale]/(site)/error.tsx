'use client';

import { useEffect } from 'react';
import { FailureState } from '../../../components/shell/FailureState';
import { errorPageCopyOf, failureCopyOf } from '../../../lib/i18n/failure-copy.client';
import { useLocale } from '../../../i18n/navigation';

/**
 * The error boundary for the public site — §4.13 WS-09, issue #263.
 *
 * <h2>Why it exists beside the root one</h2>
 *
 * Next uses the nearest boundary above the segment that threw, so this catches everything in
 * `app/(site)` and the root `app/error.tsx` catches the rest. The difference is the frame:
 * this one renders inside the group's layout and therefore keeps the whole header and footer,
 * which is what §4.13 asks for, and the root one uses `MinimalShell` because its imports reach
 * every route in the application — the measurement is in that component.
 *
 * A route in this group failing is most often one of the three server reads behind the home
 * page, a category page or the search results, and every one of those already answers `null`
 * rather than throwing (`lib/api/server.ts`). So this boundary is genuinely a last resort, and
 * `reset()` is genuinely the right first offer: what reaches it is the class of fault that
 * goes away by itself.
 *
 * Everything about what may and may not be printed — the message never, the digest always —
 * is the root boundary's comment, and it is not repeated here.
 */
export default function SiteError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  /*
   * An error boundary is a client component Next renders itself, so nothing can hand it
   * words. `lib/i18n/failure-copy.client.ts` carries the eight it needs and explains why —
   * the provider that would let it look them up was measured at +24.7 KiB on every route on
   * the site, paid by every page for the benefit of this one.
   */
  const locale = useLocale();
  const copy = errorPageCopyOf(locale);

  useEffect(() => {
    console.error('A page in the public site failed to render.', error);
  }, [error]);

  return (
    <FailureState
      copy={failureCopyOf(locale)}
      title={copy.title}
      description={
        <>
          <p>{copy.description}</p>
          {error.digest !== undefined && (
            <p className="mt-4 text-sm text-white/40">
              {copy.referenceLabel}{' '}
              <span className="font-mono tabular-nums text-white/64">{error.digest}</span>
              {`. ${copy.referenceHint}`}
            </p>
          )}
        </>
      }
      action={
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-12 items-center rounded-full bg-white px-6 text-base font-medium text-on-white transition-colors duration-150 ease-in-out hover:bg-[var(--white-muted)]"
        >
          {copy.retry}
        </button>
      }
    />
  );
}
