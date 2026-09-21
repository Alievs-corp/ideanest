'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { InlineAlert, Pill } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { EXPORT_FILENAME, fetchAccountExport } from '../../lib/account/closure';
import type { DataExportPanelCopy } from '../../lib/i18n/settings-copy';
import { fillNodes } from '../../lib/i18n/placeholders';

/**
 * §4.1's A-11 — a machine-readable copy of the account. Issue #279.
 *
 * <h2>Why this is a button and not a link</h2>
 *
 * `<a href="/v1/me/export" download>` is the obvious shape and it does not work here. The
 * access token lives in a module variable and travels as an `Authorization` header;
 * a navigation the browser makes on its own carries no header, so the link would fetch a 401
 * and the browser would download the problem document. The bytes are fetched with the session
 * and handed to the browser afterwards.
 *
 * <h2>The object URL is revoked, and not on a timer</h2>
 *
 * A `blob:` URL keeps the whole export alive in memory until it is revoked, and the export is
 * everything the platform holds about a person. It is revoked in the same task, immediately
 * after the click is dispatched — every browser that supports `download` has already taken its
 * own reference by then, and a `setTimeout` would be a guess about how long that takes.
 *
 * <h2>The rate limit is surfaced rather than retried</h2>
 *
 * §17.4 calls this "the single most valuable request an attacker with a stolen access token
 * can make" and bounds it per account. A client that retried on a 429 would be spending
 * somebody else's allowance on their behalf.
 */
export interface DataExportPanelProps {
  /** Every word this panel draws, resolved on the server — #80. */
  readonly copy: DataExportPanelCopy;
}

export function DataExportPanel({ copy }: DataExportPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  async function download(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const blob = await fetchAccountExport();

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = EXPORT_FILENAME;
      anchor.click();
      URL.revokeObjectURL(url);

      setDownloaded(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) {
        setError(cause.problem?.detail ?? copy.rateLimited);
      } else if (cause instanceof ApiError) {
        setError(cause.problem?.detail ?? cause.problem?.title ?? copy.refused);
      } else {
        setError(copy.failures.unreachableDetail);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{copy.heading}</h2>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">{copy.intro}</p>

      {error !== null && (
        <div className="mt-5">
          <InlineAlert variant="danger" title={copy.errorTitle}>
            <p>{error}</p>
          </InlineAlert>
        </div>
      )}

      {downloaded && error === null && (
        <div className="mt-5">
          <InlineAlert variant="success" title={copy.savedTitle}>
            <p>
              {fillNodes(copy.savedBody, {
                filename: <code className="font-mono">{EXPORT_FILENAME}</code>,
              })}
            </p>
          </InlineAlert>
        </div>
      )}

      <div className="mt-6">
        <Pill
          type="button"
          disabled={busy}
          onClick={() => void download()}
          iconLeft={<Download aria-hidden="true" className="size-4" />}
        >
          {busy ? copy.preparing : copy.download}
        </Pill>
      </div>
    </section>
  );
}
