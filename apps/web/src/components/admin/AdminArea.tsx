import { Link } from '../../i18n/navigation';
import type { ReactNode } from 'react';
import { MAIN_CONTENT_ID, SkipLink } from '../shell/SkipLink';
import { AdminNav } from './AdminNav';
import { ConsoleGate } from './ConsoleGate';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { ConsoleReader } from './ConsoleReader';
import { adminShellCopy, shellCopy } from '../../lib/i18n/shell-copy.server';
import { consoleChrome } from '../../lib/i18n/admin/console.server';

/**
 * The frame every console screen renders inside — §4.11 and §4.13 WS-01, issue #294.
 *
 * <h2>Its own shell, and not the site's</h2>
 *
 * `app/(site)/layout.tsx` said this was coming and said why in one line: "the admin console
 * gets its own shell". Two reasons, and the second is the one worth measuring.
 *
 * <strong>The public header is the wrong chrome.</strong> It offers Discover, the categories,
 * search, "Start a project" and an account menu. A member of staff clearing a report queue
 * wants none of those, and a header whose most prominent control invites them to start a
 * campaign is a header designed for somebody else.
 *
 * <strong>And it is not free.</strong> `MinimalShell` records the measurement:
 * `SiteHeader` reaches `@ideanest/ui`'s root barrel for `TopBar`, `useDismiss` and
 * `useFocusTrap`, and a barrel in a `transpilePackages` source package lands in one shared
 * chunk — 83.3 KiB of it, the last time somebody put `SiteShell` somewhere it did not
 * belong. The console has eleven routes and would have paid that eleven times over for a
 * navigation bar it does not use.
 *
 * <h2>Why not `MinimalShell`, then</h2>
 *
 * Because a console is not a sign-in page. `MinimalShell` is a wordmark and a `<main>`, which
 * is right for a screen with one job and wrong for a surface somebody moves around inside
 * several times in a sitting. What this adds over it is exactly the rail, and the rail is
 * the whole of #294.
 *
 * <h2>One `<main>`, and it is here</h2>
 *
 * The two screens that existed before this each declared their own, because there was no
 * shell to be inside; both lost it in the same change that added this file. Two `<main>`
 * elements is not a duplicated landmark so much as an ambiguous one — assistive technology
 * offers "jump to main" and there is now more than one answer. `AccountArea` made the same
 * correction to `/settings/sessions` and `/settings/notifications`.
 *
 * <h2>The rail is beside the content, not above it</h2>
 *
 * docs/ui-kit.md §6.3 puts a rail on the left of a working surface, and a console is the
 * definition of one: ten destinations somebody moves between while holding one complaint in
 * their head. Above the content it would push every screen down and would compete with the
 * bar a few pixels above it.
 *
 * <h2>It says who <em>is</em> looking, and still gates nothing — issue #405</h2>
 *
 * <strong>`ConsoleReader` is a statement, not a check.</strong> The bar named neither the
 * reader nor their authority, so somebody moving between screens could not tell a screen
 * that was not theirs from one that was broken — on a surface where a machine and a shift
 * are shared. That is a sentence the console can now say, because #295 gave it
 * `GET /v1/admin/me` and #402 gave it somewhere to turn an identifier into a name.
 *
 * <p>It changes nothing about the paragraph below, which is still the rule: the line renders
 * what the service told the browser, the service refuses every read behind every screen
 * regardless of what the line says, and a reader who is not staff gets no line rather than a
 * refusal — because the console index already says that in a sentence, and a shell is the
 * wrong place to tell somebody they do not work here.
 *
 * <h2>It says who may be looking, and the service still decides</h2>
 *
 * <p>This file used to state that the route was not a gate and must not become one, on the
 * ground that there was no role model to gate with. #295 built one, and the paragraph below
 * is what survives of the argument: <strong>the service refuses every read behind every
 * screen, and that check is the one that matters.</strong> The access token is a module
 * variable in the browser and the refresh cookie rotates on use, so nothing on the server can
 * authenticate a console request without ending the session it is inspecting — a server-side
 * gate is therefore not available, and a client-side one is a courtesy rather than a lock.
 *
 * <p>What changed is that the courtesy is worth paying for. `ConsoleMembershipProvider` reads
 * `GET /v1/admin/me` once for the whole frame; `ConsoleGate` turns "you do not work here" into
 * one sentence instead of twenty-eight invitations and twenty-eight refusals; and `AdminNav`
 * draws the entries the reader can actually open. All three are the same read, which is why
 * it is read here and not three times.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §5 gives an administrative surface the same budget as account
 * settings — 150ms of colour on a control, and nothing that moves.
 */
export interface AdminAreaProps {
  readonly children: ReactNode;
}

export async function AdminArea({ children }: AdminAreaProps) {
  /*
   * The skip link is the shell's rather than the console's: it is the same control on every
   * page of the platform and it is drawn from the same key. Everything else on this frame is
   * the console's own, and translated since #324 — `lib/i18n/admin-copy.ts` records why the
   * earlier decision to leave it English was reversed, and what is still English inside it.
   */
  const { skipToContent } = await shellCopy();
  const copy = await adminShellCopy();
  /*
   * Only the refusals off the chrome, and they are the shell's because the gate's sentence is
   * about the console rather than about a screen. Resolved here rather than inside the gate
   * for the reason every console component takes its words as props: the catalogue is read on
   * the server, and a client component that fetched its own copy would be a second way for
   * the same sentence to arrive.
   */
  const { refusals } = await consoleChrome();

  return (
    <ConsoleMembershipProvider>
      <div className="relative flex min-h-dvh flex-col">
        <SkipLink label={skipToContent} />

        {/*
          A bar rather than a header component: two links and a label. It is deliberately not
          `TopBar` from the kit — see the docblock on what importing the barrel costs a route
          that draws no navigation.
        */}
        <div className="border-b border-white/8 bg-surface-1">
          <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <Link
              href="/admin"
              className="rounded-lg text-sm font-semibold tracking-[-0.01em] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
            >
              IdeaNest{' '}
              <span className="font-normal text-white/48">{copy.console}</span>
            </Link>

            <div className="flex flex-wrap items-center gap-4">
              {/* Who is reading, and with what authority. Nothing at all for anybody else. */}
              <ConsoleReader copy={copy} />

              {/*
                The way out. A console with no link back to the platform is one somebody
                leaves by editing the address bar, and the screens here are read alongside the
                pages they are about.
              */}
              <Link
                href="/"
                className="rounded-lg text-sm text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                {copy.backToSite}
              </Link>
            </div>
          </div>
        </div>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] flex-1 px-5 py-10 focus:outline-none sm:px-6 sm:py-12"
        >
          <div className="flex flex-col gap-10 lg:flex-row lg:gap-14">
            <div className="lg:w-[15rem] lg:shrink-0">
              <AdminNav copy={copy} />
            </div>
            {/*
              `min-w-0` so a ledger table or a provider reference scrolls inside its own
              container rather than widening the flex row and pushing the rail off the side of
              the page.
            */}
            <div className="min-w-0 flex-1">
              {/*
                The children rather than the frame: a reader who does not work here still gets
                the bar, the rail's heading structure and the way back to the site, because a
                refusal inside the chrome is a page and a refusal instead of it is a dead end.
              */}
              <ConsoleGate copy={refusals}>{children}</ConsoleGate>
            </div>
          </div>
        </main>
      </div>
    </ConsoleMembershipProvider>
  );
}
