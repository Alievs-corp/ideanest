import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { MAIN_CONTENT_ID, SkipLink } from './SkipLink';
import { WhatsAppLauncher } from './WhatsAppLauncher';
import { shellCopy, whatsappCopy } from '../../lib/i18n/shell-copy.server';

/**
 * The frame every public page renders inside — §4.13 WS-01, WS-02, WS-09.
 *
 * <h2>A component, not only a layout</h2>
 *
 * `app/(site)/layout.tsx` is one caller. The other two are `app/not-found.tsx` and
 * `app/error.tsx`, and they are the reason this is a component at all: both of those files
 * sit at the ROOT of the route tree, because that is where Next looks for them when a
 * request matches nothing and when a render throws anywhere. A root file does not render
 * inside `(site)`'s layout, so a shell that existed only as that layout would be a shell
 * that disappears at exactly the two moments WS-09 says it must not — "not found, error and
 * maintenance, all of them inside the shell rather than replacing it". A visitor who mistypes
 * a URL and loses the navigation has no way back except the back button.
 *
 * <h2>One `<main>`, and it is here</h2>
 *
 * The skip link's target, and the only `<main>` on the page. A second one is not a
 * duplicated landmark so much as an ambiguous one: assistive technology offers "jump to
 * main" and there is now more than one answer. `DiscoveryView` used to carry its own and no
 * longer does, for this reason.
 *
 * `tabIndex={-1}` because a fragment link scrolls to an element but does not move focus into
 * it unless the element can take focus. Without it the skip link scrolls the page and leaves
 * the keyboard exactly where it was, which is the failure that makes people think skip links
 * do not work.
 *
 * <h2>Motion</h2>
 *
 * The header's collapse — docs/motion-system.md §5 gives the shell a budget of one, and says
 * why it is worth stating: this is on every route in the table below it, so its budget is paid
 * on all of them at once. The footer does not animate. Neither does the transition between
 * pages: §5's own table keeps page transitions to "marketing to app only", and a 300ms overlay
 * between a campaign page and its checkout is pure friction.
 *
 * <p>`WhatsAppLauncher`'s halo is the second animation on this frame, and the budget says one.
 * That component's docblock states the exception rather than leaving it to be noticed, and
 * narrows it: the movement stops on the surfaces §5 gives "None" — `/projects/new` and the six
 * editor tabs — and the checkout never carries this shell at all. Whether the frame keeps a
 * second animation at all is a design decision, not this component's to make quietly.
 */

export interface SiteShellProps {
  readonly children: ReactNode;
}

export async function SiteShell({ children }: SiteShellProps) {
  /*
   * The shell's words, looked up once here and handed to the client components below as a
   * plain object. `lib/i18n/shell-copy.ts` explains why they are a prop rather than a hook:
   * a `NextIntlClientProvider` above this component would be a provider above every route on
   * the site, and this repository has already measured what that costs.
   */
  const [copy, whatsapp] = await Promise.all([shellCopy(), whatsappCopy()]);

  return (
    /*
     * `flex-col` with the footer pushed down by `mt-24` on itself rather than by a spacer:
     * a short page — a 404, an empty search — should still end with the footer at the bottom
     * of the content rather than floating in the middle of a tall viewport. `min-h-dvh` on
     * the column and `flex-1` on the main is what does it.
     */
    <div className="relative flex min-h-dvh flex-col">
      <SkipLink label={copy.skipToContent} />
      <SiteHeader copy={copy} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <SiteFooter />

      {/*
        LAST IN THE DOM, and that is the accessibility decision in it. A floating control put
        first would be the first thing a screen reader meets on every page of the site and the
        first tab stop after the skip link, ahead of the navigation and the heading somebody
        came for. It is `fixed`, so where it sits in the source changes nothing about where it
        is drawn.
      */}
      <WhatsAppLauncher copy={whatsapp} />
    </div>
  );
}
