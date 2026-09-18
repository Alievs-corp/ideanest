'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';
import { useConsoleMembership } from './ConsoleMembership';

/**
 * Whether the console opens at all — §4.11's role model, issue #295.
 *
 * <h2>What this replaces</h2>
 *
 * <p>Nothing, which was the problem. Every screen refused correctly and the shell said nothing,
 * so a signed-in visitor who opened `/admin` out of curiosity got the console's chrome, a rail
 * of twenty-eight destinations, and a panel on each of them saying they did not work here.
 * Twenty-eight invitations and twenty-eight refusals is a worse answer than one sentence.
 *
 * <h2>It is the console's front door, and it is not the lock</h2>
 *
 * <p><strong>This does not make the browser the authority.</strong> `AdminArea` and `staff.ts`
 * have said since #294 why it cannot be: the access token is a module variable in this process
 * and the refresh cookie rotates on every use, so nothing on the server can authenticate a
 * console request without spending the session it is checking. The service refuses every read
 * behind every screen, and that check is the one that matters.
 *
 * <p>What this adds is the sentence, one screen earlier. `GET /v1/admin/me` is the one route
 * under `/v1/admin` that refuses nobody, so the console can tell "you do not work here" from
 * "the service is down" — and a reader who does not work here is told that once, instead of
 * meeting it on each screen they try.
 *
 * <h2>The panel is `InlineAlert`'s markup, copied, and the copy is measured</h2>
 *
 * <p>The obvious version of this file renders `ConsoleRefusal`, which is the same two sentences
 * already written and already argued about. It was written that way and it broke the
 * performance budget: `ConsoleRefusal` imports `InlineAlert` from `@ideanest/ui`'s root barrel,
 * this component is on all thirty console routes, and a barrel in a `transpilePackages` source
 * package lands in one shared chunk — so `/admin`, which is a server component over a frozen
 * list and had no client kit code at all, went <strong>47.2 KiB over its 510 KiB ceiling</strong>.
 * `apps/web/performance/README.md` records the same mechanism costing the site shell 83 KiB
 * across twenty-three routes, and `ConsoleIndex` copies `Tag`'s classes for the same reason.
 *
 * <p>So the info variant is fifteen lines of markup here: `border-l-info` on `surface-2`, the
 * title in white, the body at 64%. The screens keep using `ConsoleRefusal` — they have already
 * paid for the barrel — and this is the one component that is drawn before any of them.
 *
 * <p>The icon is `lucide-react`'s, imported by name rather than through a barrel, and it is
 * `aria-hidden`: docs/ui-kit.md §9.2 forbids colour as the only signal, and what carries the
 * meaning here is the sentence.
 *
 * <p><strong>Not `danger`, for either refusal.</strong> `ConsoleRefusal` makes the argument:
 * a session that expired is ordinary, and somebody who followed a URL they were sent has not
 * done anything wrong. Red would be the interface shouting at them for it.
 *
 * <h2>A failed read does not become a wall</h2>
 *
 * <p>`failed` renders the children. A network blip on the shell's own read must not close a
 * console that is otherwise working: the screens behind it each make their own request, each
 * refuses honestly, and the service is the authority regardless of what this component
 * managed to find out. Refusing here on a failure would be this file deciding, on no
 * evidence, that somebody does not work here — which is the one direction a client-side gate
 * must not fail in.
 *
 * <h2>Nothing at all while it is loading</h2>
 *
 * <p>No skeleton and no "checking…". docs/motion-system.md §5 gives an administrative surface
 * no movement, and a console that painted a screen, then a refusal, then the screen again on
 * every navigation would be movement in the place it least belongs. The read is one request
 * against a route that answers from one query.
 */
export interface ConsoleGateProps {
  readonly copy: ConsoleRefusalsCopy;
  readonly children: ReactNode;
}

export function ConsoleGate({ copy, children }: ConsoleGateProps) {
  const { status, membership } = useConsoleMembership();

  if (status === 'loading') return null;

  if (status === 'signed-out') {
    return (
      <Notice title={copy.signedOutTitle}>
        {fillPlaceholders(copy.signedOutBody, { subject: copy.consoleSubject })}
      </Notice>
    );
  }

  /*
   * `forbidden` is the impossible one — `/v1/admin/me` answers a stranger with `staff: false`
   * rather than a 403 — and it is answered with the same sentence as `staff: false` rather
   * than with a branch asserting that it cannot happen. If the route ever does start refusing,
   * the console says the true thing instead of drawing itself.
   *
   * Neither sentence names a capability: there is none that opens the console as a whole.
   * Which screens a member of staff may open is the rail's answer, and `/admin/staff` explains
   * what each capability is for.
   */
  if (status === 'forbidden' || (status === 'ready' && membership?.staff !== true)) {
    return <Notice title={copy.forbiddenTitle}>{copy.forbiddenBody}</Notice>;
  }

  return <>{children}</>;
}

/** `InlineAlert`'s info variant, in markup. The docblock above records what importing it cost. */
function Notice({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-md border-l-2 border-l-info bg-surface-2 p-4 text-sm">
      <Info aria-hidden="true" className="mt-px size-4 shrink-0 text-info" />

      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">{title}</p>
        <div className="mt-1 text-white/64">{children}</div>
      </div>
    </div>
  );
}
