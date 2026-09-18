'use client';

import { Link } from '../../i18n/navigation';
import type { ConsoleIndexCopy } from '../../lib/i18n/admin-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import {
  CONSOLE_MODULES,
  firstOpenableScreen,
  visibleConsoleModules,
  type ConsoleModule,
  type ModuleState,
} from '../../lib/admin/navigation';
import { useConsoleMembership } from './ConsoleMembership';

/**
 * §4.11's sixteen modules, and the state of each — issue #294.
 *
 * <h2>The page is the epic's definition of done, rendered</h2>
 *
 * #259 requires that "every module in §4.11's table has either a screen or an open blocker
 * naming what it needs". A rail listing the nine that work would meet that on paper and lose
 * it in practice: a console with nine entries reads as a console that is nine screens, and
 * the seven missing modules become something somebody discovers by asking. This is the page
 * that answers the question before it is asked.
 *
 * <h2>A blocked module is not a link, and does not look like one</h2>
 *
 * There is no href, no hover treatment and no cursor change — the row is text with a reason
 * under it. A disabled link is worse than no link: it is still in the tab order in some
 * browsers, it still reads as a destination to a screen reader, and it teaches people to
 * click things that do nothing.
 *
 * <h2>The state is never colour alone</h2>
 *
 * docs/ui-kit.md §9.2. Each row carries a `Tag` whose text says which of the three states
 * it is in, so the distinction survives a monochrome screen and a screen reader. The colour
 * is a second signal and never the only one — and <strong>nothing here is lime</strong>:
 * `--lime-500` means "act now" (docs/ui-kit.md), and a module that is blocked on somebody
 * else's issue is the opposite of something to act on.
 *
 * <h2>It lists the modules this reader can open — issue #295</h2>
 *
 * <p>The rail draws the entries somebody may open and this page is the same rule applied to
 * subjects rather than destinations: a module is listed when any one of its screens is theirs,
 * and the row links to the first of them that is — which is not always the module's own
 * `href`, because AD-04's account administration and its staff roster are two capabilities
 * under one module.
 *
 * <p><strong>What is hidden is counted and said out loud.</strong> One line under the list
 * gives the number of §4.11's modules that this reader's roles do not open, and links to
 * `/admin/staff`, where every capability is named and explained. The objection the rail's old
 * behaviour was built on — that somebody who cannot see a screen has no way to learn it exists
 * — is answered there rather than by listing twenty-three dead ends.
 *
 * <h2>A client component, which it did not use to be, and what that cost</h2>
 *
 * <p>It was a server component over a frozen list and cost the browser nothing. Filtering by
 * capability needs the membership, the membership lives in the browser — `staff.ts` records
 * why it cannot live anywhere else — so this became a client component and `/[locale]/admin`
 * gained the weight of its own markup. `apps/web/performance/budgets.json` is where that shows
 * up, and the check that guards it is the reason the number is in the pull request rather than
 * in somebody's memory.
 *
 * <p><strong>It still imports nothing from the kit, and now for a second reason.</strong>
 * `@ideanest/ui`'s root barrel re-exports `Table`, `Field`, `Radio` and `Combobox`; a barrel in
 * a `transpilePackages` source package lands in one shared chunk, and `ConsoleGate` records it
 * costing this route 47.2 KiB the one time the console shell reached for it. The state label
 * is `Tag`'s classes copied deliberately.
 *
 * <p>The three spans below are `Tag`'s own variant classes, copied deliberately and not
 * abstracted: three class strings in one file is a smaller thing to keep in step than a
 * second component in the kit whose only purpose is to be importable from a server.
 */

/*
 * WHAT A READER IS TOLD THE STATE IS lives in `admin.states` since #324. Words, because
 * colour is not enough (docs/ui-kit.md §9.2) — the tone below sits beside the word and never
 * instead of it.
 */

/**
 * The second signal, never the only one.
 *
 * `default` for a blocked module rather than `danger`: nothing is wrong with AD-06 — it is
 * waiting on a refund endpoint that has not been written, which is a fact about the schedule
 * and not a fault. Red on seven of sixteen rows would make the page read as an incident.
 */
const STATE_TONES: Readonly<Record<ModuleState, string>> = {
  built: 'bg-success/12 text-success',
  partial: 'bg-warning/12 text-warning',
  blocked: 'bg-surface-3 text-white/64',
};

/** `Tag`'s shape, without the barrel. See the docblock on why this page cannot import it. */
const TAG = 'inline-flex h-[26px] items-center gap-1 rounded-sm px-2.5 text-xs font-medium';

function issueHref(issue: number): string {
  return `https://github.com/ismetcahangirov/ideanest/issues/${issue}`;
}

function ModuleRow({
  module,
  href,
  copy,
}: {
  readonly module: ConsoleModule;
  /**
   * Where this reader's copy of the row points — `firstOpenableScreen`, not `module.href`.
   *
   * <p>Null for a module with no screen at all, which is the row that is text rather than a
   * link and has been since #294: a disabled link is still in the tab order, still reads as a
   * destination, and teaches people to click things that do nothing.
   */
  readonly href: string | null;
  readonly copy: ConsoleIndexCopy;
}) {
  const words = copy.modules[module.code];
  const heading = (
    <span className="text-[15px] font-medium text-white">
      <span className="mr-2 font-mono text-xs tracking-[0.04em] text-white/40">{module.code}</span>
      {words?.title}
    </span>
  );

  return (
    <li className="rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {href === null ? (
          heading
        ) : (
          <Link
            href={href}
            className="rounded-lg transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {heading}
          </Link>
        )}
        <span className={`${TAG} ${STATE_TONES[module.state]}`}>
          {copy.states[module.state]}
        </span>
      </div>

      <p className="mt-2 max-w-[68ch] text-sm text-white/64">{words?.summary}</p>

      {words?.waitingOn === undefined ? null : (
        <p className="mt-2 max-w-[68ch] text-sm text-white/48">
          {words.waitingOn}{' '}
          <a
            href={issueHref(module.issue)}
            className="text-white/64 underline underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {fillPlaceholders(copy.issue, { issue: String(module.issue) })}
          </a>
        </p>
      )}
    </li>
  );
}

export interface ConsoleIndexProps {
  /** The page's words, resolved by the route — see `lib/i18n/admin-copy.ts`. */
  readonly copy: ConsoleIndexCopy;
}

export function ConsoleIndex({ copy }: ConsoleIndexProps) {
  const { membership } = useConsoleMembership();
  const capabilities = membership?.capabilities ?? null;

  const modules = visibleConsoleModules(capabilities);

  /*
   * #405: this sentence used to say how many modules have a screen and then promise that
   * "the rest say what they are waiting for". All sixteen have a screen, so there was no
   * rest and the second clause described nothing — while nine of the sixteen are partly
   * built and do carry a waiting-on note, which is the fact it was reaching for. It says
   * how many are finished and how many are not.
   *
   * The three numbers count what this reader is looking at rather than what §4.11 has. A
   * standfirst that said "sixteen modules" over five rows would be describing a different
   * page from the one below it; the eleven that are missing are counted on their own line.
   */
  const complete = modules.filter((module) => module.state === 'built').length;
  const partial = modules.filter((module) => module.state === 'partial').length;
  const hidden = CONSOLE_MODULES.length - modules.length;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
        {copy.title}
      </h1>
      <p className="mt-2 max-w-[68ch] text-sm text-white/64">
        {fillPlaceholders(copy.standfirst, {
          total: String(modules.length),
          complete: String(complete),
          partial: String(partial),
        })}
      </p>

      <ul className="mt-8 flex list-none flex-col gap-3">
        {modules.map((module) => (
          <ModuleRow
            key={module.code}
            module={module}
            href={firstOpenableScreen(module, capabilities)}
            copy={copy}
          />
        ))}
      </ul>

      {hidden === 0 ? null : (
        <p className="mt-8 max-w-[68ch] text-sm text-white/48">
          {fillPlaceholders(copy.notYours, { count: String(hidden) })}{' '}
          {/*
            The answer to the objection the old rail was built on. What each role holds is a
            screen rather than a sentence, and it is one click away.
          */}
          <Link
            href="/admin/staff"
            className="text-white/64 underline underline-offset-2 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {copy.rolesLink}
          </Link>
        </p>
      )}

      <p className="mt-8 max-w-[68ch] text-sm text-white/48">{copy.footnote}</p>
    </div>
  );
}
