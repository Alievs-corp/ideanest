'use client';

import { useEffect, useRef, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { shortId } from '../../lib/admin/refusals';
import { mayOpenConsoleLink } from '../../lib/admin/navigation';
import { holds } from '../../lib/admin/staff';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { DirectoryNames } from '../../lib/admin/directory';
import type { ConsoleIdentityCopy } from '../../lib/i18n/admin/common-copy';
import { useConsoleMembership } from './ConsoleMembership';

/**
 * How the console says who or what something is — issue #402.
 *
 * <h2>The defect these three components close</h2>
 *
 * The console identified people, campaigns, pledges and categories by eight hexadecimal
 * characters and then asked the operator to type the other twenty-eight from memory. One
 * workflow could not be finished because of it: `/admin/staff` asks for a full account
 * identifier "from the account directory", and `/admin/users` displayed no identifier
 * anywhere, had no copy control and no clickable row.
 *
 * <p>So there are exactly three things here, and each closes one half of that:
 *
 * <ul>
 *   <li>{@link EntityName} renders a name where the console rendered a fragment, with the
 *       fragment kept beside it — the identifier is what somebody quotes to an engineer, so
 *       replacing it outright would trade one missing fact for another.
 *   <li>{@link CopyIdentifier} puts the whole identifier on the clipboard, which removes the
 *       dead end on its own: five screens ask for a UUID typed by hand, and every one of
 *       them is now reachable from the screen that supplies it.
 *   <li>{@link Identifier} is the fragment on its own, for the rows where there is no name
 *       to resolve — a transaction, a posting, an idempotency key.
 * </ul>
 *
 * <h2>Colour is never the signal</h2>
 *
 * CLAUDE.md: colour alone must never carry meaning. Copying answers with a word rather than
 * a flash of green, and the word is announced — an operator who has just copied an account
 * identifier is about to paste it into a field that grants somebody the authority to move
 * money, and "did that work" is not a question to answer by looking closely.
 *
 * <h2>Motion</h2>
 *
 * None beyond the 150ms of colour docs/motion-system.md §5 gives an administrative control.
 * The confirmation appears and disappears; nothing moves.
 */

/** The eight characters the console has always shown, in the type it has always shown them in. */
export function Identifier({ id, className }: { readonly id: string; readonly className?: string }) {
  return (
    <span className={cx('font-mono', className)} title={id}>
      {shortId(id)}
    </span>
  );
}

export interface EntityNameProps {
  readonly id: string;
  /** What the directory resolved, or nothing yet. {@link useDirectoryNames} produces it. */
  readonly names: DirectoryNames;
  readonly kind: 'account' | 'project';
  readonly copy: ConsoleIdentityCopy;
  /**
   * Whether to offer the identifier for copying beside the name.
   *
   * Off by default: a queue of twenty-five rows with a control on each is twenty-five
   * controls in the tab order for a thing somebody wanted once. On for the rows that feed
   * the five hand-typed fields — a campaign on the payout queue, an account in the
   * directory — which is the workflow #402 is about.
   */
  readonly copyable?: boolean;
  readonly className?: string;
}

/**
 * A person or a campaign, named where the console can name it.
 *
 * <p><strong>The identifier does not disappear when the name arrives.</strong> It is what an
 * operator quotes in a support ticket and what the service names back in a refusal, so a row
 * that showed only "Kamran Əliyev" would have removed the fact the previous version showed
 * and added a different gap. The name leads because that is what a human is looking for.
 *
 * <p><strong>A name that has not resolved renders exactly what this screen rendered
 * before.</strong> The lookup is a second read and is allowed to fail; when it does, or
 * before it answers, the row is the eight-character fragment it always was. Nothing here
 * renders a skeleton: a queue that shimmered in twenty places while its names arrived would
 * be a screen that looks broken every time it loads.
 *
 * <p><strong>A campaign links to the console's own preview, never to its public page —
 * #399.</strong> It used to link to `/projects/{creatorSlug}/{slug}` whenever the directory
 * had both halves of that path, and the directory has both halves for every campaign
 * regardless of state. So a report about a suspended campaign, or an audit row about a
 * rejected one, offered a link that answers 404 — at exactly the moment somebody is trying
 * to find out what was suspended. `/admin/campaigns/{id}` renders any campaign in any state,
 * so the link is now always a real one and the "no path, no link" case has stopped existing
 * for campaigns.
 *
 * <p><strong>Only where the reader may open it.</strong> The preview is `MODERATE_CONTENT`'s, like
 * the campaign directory it belongs to; finance reading the audit trail or the payout queue was
 * offered a link that answered with a refusal. A reader without it sees the name, unlinked.
 *
 * <p><strong>An account links to the console's own account screen when the reader may open
 * it.</strong> It linked to the public profile everywhere, so a support ticket's requester or a
 * staff grant's holder — names on screens whose whole subject is that person's account — took
 * the reader out of the console to the page every visitor sees. `/admin/users/{id}` is
 * `ADMINISTER_ACCOUNTS`; a reader without it, finance reading the payment journal, keeps the
 * public profile, which is public for every account that has one.
 */
export function EntityName({
  id,
  names,
  kind,
  copy,
  copyable = false,
  className,
}: EntityNameProps) {
  const { membership } = useConsoleMembership();
  const account = kind === 'account' ? names.accounts.get(id) : undefined;
  const project = kind === 'project' ? names.projects.get(id) : undefined;

  const name = account?.name ?? project?.title ?? null;
  const href =
    account !== undefined
      ? holds(membership, 'ADMINISTER_ACCOUNTS')
        ? `/admin/users/${encodeURIComponent(account.id)}`
        : `/${account.slug}`
      : project !== undefined && mayOpenConsoleLink('/admin/campaigns', membership?.capabilities ?? null)
        ? `/admin/campaigns/${encodeURIComponent(project.id)}`
        : null;

  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      {name === null ? (
        <Identifier id={id} className="text-white/80" />
      ) : (
        <>
          {href === null ? (
            <span className="text-white">{name}</span>
          ) : (
            <Link
              href={href}
              className="rounded text-white underline decoration-white/24 underline-offset-2 transition-colors duration-150 ease-in-out hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
            >
              {name}
            </Link>
          )}
          <Identifier id={id} className="text-xs text-white/40" />
        </>
      )}
      {copyable && <CopyIdentifier id={id} copy={copy} />}
    </span>
  );
}

export interface CopyIdentifierProps {
  readonly id: string;
  readonly copy: ConsoleIdentityCopy;
  readonly className?: string;
}

/**
 * Puts a whole identifier on the clipboard.
 *
 * <p><strong>This is the control that unblocks the workflow.</strong> Granting a staff role
 * needs a full account identifier and the account directory displayed none; five more
 * screens take one typed by hand. A picker on each would be six pickers; a copy control on
 * the screens that hold the identifiers is one component, and #402 says so itself.
 *
 * <p>The accessible name carries the identifier's shortened form rather than being "Copy" on
 * every row — a list of twenty-five identical control names is a list nobody can navigate by
 * name. The full value is on the `title`, so it can be read without copying it.
 *
 * <p><strong>Refusal is silent by design.</strong> A browser may refuse clipboard access and
 * there is nothing the reader can do about it, so the confirmation simply does not appear;
 * the identifier is selectable text a few pixels away, which is the ordinary fallback.
 * `PrelaunchPanel` made the same decision for the same reason.
 */
export function CopyIdentifier({ id, copy, className }: CopyIdentifierProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The confirmation is on a timer, and a row that unmounts while it is running — a queue
  // reloading under the reader — would otherwise set state on a component that is gone.
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  async function put(): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className={cx('inline-flex items-baseline gap-2', className)}>
      <button
        type="button"
        onClick={() => void put()}
        title={id}
        aria-label={fillPlaceholders(copy.copyLabel, { id: shortId(id) })}
        className="rounded text-xs text-white/48 underline decoration-dotted underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
      >
        {copy.copy}
      </button>
      {/*
        Announced rather than only drawn. The reader is about to paste this into a field
        that decides who may move money, and "did that work" should not be a question
        answered by looking closely at a colour.
      */}
      <span role="status" aria-live="polite" className="text-xs text-white/48">
        {copied ? copy.copied : ''}
      </span>
    </span>
  );
}

/** `cn` from the kit is in the barrel, and the barrel costs a route 83 KiB. This is the join. */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
