'use client';

import type { ReactNode } from 'react';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
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
 * <h2>The refusal is `ConsoleRefusal`, and deliberately not a second one</h2>
 *
 * <p>The two sentences a console screen can meet before it has anything to draw are exactly
 * the two this gate can meet, and they are already written, already translated and already
 * argued about — including why neither is `danger`. A second panel here would be a second
 * place to keep the same refusal correct, and `ConsoleReader` records what a shell component
 * that reaches for `@ideanest/ui`'s root barrel costs a route that draws no controls.
 *
 * <p>The subject it takes is the console itself — `refusals.consoleSubject`, already inflected
 * for its position in the two languages that inflect it, like every other screen's noun.
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
    return <ConsoleRefusal status="signed-out" subject={copy.consoleSubject} copy={copy} />;
  }

  /*
   * `forbidden` is the impossible one — `/v1/admin/me` answers a stranger with `staff: false`
   * rather than a 403 — and it is answered with the same sentence as `staff: false` rather
   * than with a branch asserting that it cannot happen. If the route ever does start refusing,
   * the console says the true thing instead of drawing itself.
   *
   * `capability` is deliberately absent on both: there is no capability that opens the console
   * as a whole, so the sentence is the one about standing rather than the one about authority.
   * Which screens a member of staff may open is the rail's answer, and `/admin/staff` explains
   * what each capability is for.
   */
  if (status === 'forbidden' || (status === 'ready' && membership?.staff !== true)) {
    return <ConsoleRefusal status="forbidden" subject={copy.consoleSubject} copy={copy} />;
  }

  return <>{children}</>;
}
