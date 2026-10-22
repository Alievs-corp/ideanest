'use client';

import { Link } from '../../i18n/navigation';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { readTemplateList } from '../../lib/admin/email-templates';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { EmailTemplateIndexCopy } from '../../lib/i18n/admin/platform-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * The front door of §4.11's AD-15 — issue #315.
 *
 * <h2>Why a list page exists rather than a dropdown</h2>
 *
 * There are tens of notification types and each one is a separate piece of copy with its own
 * history in each of four languages. The question an administrator arrives with is "which of
 * these has somebody rewritten", so every row says it: the languages it has been rewritten in,
 * each with the version that is live, or that it sends the shipped copy everywhere.
 *
 * <h2>Names, not constants</h2>
 *
 * Each row is titled with the notification's name in the reader's language. The constant is
 * what the service calls it, and a list of `PAYOUT_DETAILS_NEEDED` rows is a list somebody has
 * to translate in their head.
 *
 * <h2>The one template a recipient cannot switch off</h2>
 *
 * The account-security notice is marked, because it reaches everybody whatever their
 * preferences say. What protects every template's facts is not this screen: the service
 * refuses an override that drops a placeholder the shipped copy carries.
 */
export interface EmailTemplateIndexProps {
  readonly copy: EmailTemplateIndexCopy;
}

export function EmailTemplateIndex({ copy }: EmailTemplateIndexProps) {
  const templates = useConsoleResource((signal) => readTemplateList(signal), copy.subject, copy.refusals, []);

  if (templates.status === 'signed-out' || templates.status === 'forbidden') {
    return <ConsoleRefusal status={templates.status} capability={templates.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (templates.data === null && templates.status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingList}>
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
              <Skeleton height="1rem" width="40%" />
            </div>
          ))}
        </div>
      </SkeletonGroup>
    );
  }

  if (templates.status === 'failed' || templates.data === null) {
    return (
      <>
        <InlineAlert variant="danger" title={copy.errorTitle}>
          {templates.error ?? copy.readFailed}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={templates.reload}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  if (templates.data.templates.length === 0) {
    return <EmptyState variant="empty" title={copy.emptyTitle} description={copy.emptyBody} />;
  }

  return (
    <ul className="flex list-none flex-col gap-2">
      {templates.data.templates.map((template) => {
        const overrides = template.overrides ?? [];
        return (
          <li key={template.type}>
            <Link
              href={`/admin/email-templates/${encodeURIComponent(template.type)}`}
              className="block rounded-lg border border-fg/8 bg-surface-1 p-4 transition-colors duration-150 ease-in-out hover:border-fg/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-fg">{copy.type[template.type] ?? template.type}</p>
                <span className="flex flex-wrap items-center gap-2">
                  {/* The wire value stands in for a category the catalogue has not been
                      taught, which is readable and is the honest failure of the two. */}
                  <Tag>{copy.category[template.category] ?? template.category}</Tag>
                  {template.mandatory && <Tag>{copy.mandatory}</Tag>}
                </span>
              </div>
              <p className="mt-2 flex flex-wrap gap-2">
                {overrides.length === 0 ? (
                  <span className="text-xs text-fg-48">{copy.shippedOnly}</span>
                ) : (
                  overrides.map((override) => (
                    <Tag key={override.locale} variant="warning">
                      {fillPlaceholders(copy.rewritten, {
                        language: copy.language[override.locale] ?? override.locale,
                        version: String(override.liveVersion),
                      })}
                    </Tag>
                  ))
                )}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
