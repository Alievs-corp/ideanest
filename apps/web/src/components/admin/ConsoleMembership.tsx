'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { statusFor, wasAborted, type ConsoleStatus } from '../../lib/admin/refusals';
import { readMembership, type StaffMembership } from '../../lib/admin/staff';

/**
 * Who is reading the console, read once and shared by the shell — §4.11's role model, #295.
 *
 * <h2>Why a context and not three reads</h2>
 *
 * <p>Three things on this frame need the same answer: the line that says who is signed in,
 * the rail that draws the entries they may open, and the gate that decides whether the
 * console opens at all. `GET /v1/admin/me` is the answer to all three, and before this it was
 * fetched by whichever component wanted it — one of them, because only `ConsoleReader` did,
 * and the rail and the gate did not exist.
 *
 * <p>Three copies of that read would be three requests per navigation, three moments at which
 * the shell could disagree with itself about the reader, and — the one that matters — three
 * chances for the rail to say one thing while the gate said another. So the read is here and
 * the three consume it.
 *
 * <h2>It is a statement, not a check</h2>
 *
 * <p><strong>Nothing this provides decides whether a read is allowed.</strong> `staff.ts`
 * carries the argument in full and it is unchanged: the access token lives in a module
 * variable in the browser and the refresh cookie rotates on use, so a Server Component cannot
 * authenticate without ending the session it is inspecting — which is why the service refuses
 * every read behind every screen, and why that check is the one that matters. What this
 * changes is what the console *offers*, and `ConsoleGate` says what it does with a refusal.
 *
 * <h2>The status is the console's own five, not a fourth vocabulary</h2>
 *
 * <p>`loading`, `ready`, `signed-out`, `forbidden`, `failed` — the same union every screen
 * resolves through `useConsoleResource`, so the gate's branches read like a screen's. A `403`
 * on this route would be a service that has changed its mind about the one endpoint under
 * `/v1/admin` that refuses nobody; it is still carried rather than swallowed, because the
 * failure mode of an impossible branch is that somebody removes it and then it happens.
 */
export interface ConsoleMembershipState {
  readonly status: ConsoleStatus;
  /** Present exactly when {@link status} is `ready` — including for a reader who is not staff. */
  readonly membership: StaffMembership | null;
}

/**
 * What a consumer outside the provider sees: nothing yet.
 *
 * <p>Deliberately not a throw. A component rendered in a test, or on some future surface that
 * has not been wrapped, gets the same answer it gets during the first paint of every real
 * navigation — and every consumer already has to render that state correctly.
 */
const UNKNOWN: ConsoleMembershipState = { status: 'loading', membership: null };

const ConsoleMembershipContext = createContext<ConsoleMembershipState>(UNKNOWN);

/** What the service says the reader may do. `loading` until it has said it. */
export function useConsoleMembership(): ConsoleMembershipState {
  return useContext(ConsoleMembershipContext);
}

export interface ConsoleMembershipProviderProps {
  readonly children: ReactNode;
  /**
   * A membership to provide instead of reading one — tests only.
   *
   * <p>The rail's behaviour is "a curator sees five entries and not twenty-eight", and that is
   * a statement about a membership rather than about a fetch. Threading one in is what lets
   * the test say which reader it is talking about in one line, instead of scripting the
   * endpoint that answers it.
   */
  readonly given?: ConsoleMembershipState;
}

export function ConsoleMembershipProvider({ children, given }: ConsoleMembershipProviderProps) {
  const [state, setState] = useState<ConsoleMembershipState>(given ?? UNKNOWN);

  useEffect(() => {
    if (given !== undefined) return;

    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const membership = await readMembership(controller.signal);
        if (controller.signal.aborted) return;

        setState({ status: 'ready', membership });
      } catch (cause) {
        // Two checks rather than one, for the reason `useConsoleResource` gives: the signal
        // covers the abort this effect caused, and `wasAborted` covers one that arrived from
        // a navigation or a closed tab. Neither is a refusal and neither should read as one.
        if (controller.signal.aborted || wasAborted(cause)) return;

        setState({ status: statusFor(cause), membership: null });
      }
    }

    void load();
    return () => controller.abort();
  }, [given]);

  return (
    <ConsoleMembershipContext.Provider value={given ?? state}>
      {children}
    </ConsoleMembershipContext.Provider>
  );
}
