'use client';

import { InlineAlert } from '@ideanest/ui';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';
import { capabilityLabel, type ConsoleStatus } from '../../lib/admin/refusals';

export interface ConsoleRefusalProps {
  readonly status: ConsoleStatus;
  /** What the reader was trying to read, in the screen's own words: "the ledger". */
  readonly subject: string;
  /**
   * The capability the service said this screen wanted, when it said one — #295's
   * `meta.capability`, read off the 403 by `requiredCapabilityFrom`.
   *
   * <p>Null or absent for the other 403, which is about standing rather than authority. The
   * two are different sentences leading to different actions, and #400 is what it cost to
   * render only the second: a moderator opening the payout queue was told they were not a
   * moderator.
   */
  readonly capability?: string | null;
  readonly copy: ConsoleRefusalsCopy;
}

/**
 * The two refusals every console screen can meet before it has anything to draw.
 *
 * <p><strong>`variant="info"` and not `danger`, for both.</strong> Neither is an error in the
 * sense a red panel means: a session that expired is ordinary, and an account without the
 * authority for a screen has not done anything wrong by opening a URL somebody sent it. Red
 * here would be the interface shouting at somebody for a thing it is itself responsible for.
 *
 * <p>Returns null for the other three statuses, so a caller can render it unconditionally and
 * keep its own branch for the states that have content.
 *
 * <h2>The forbidden branch is two refusals — #400</h2>
 *
 * <p>`StaffDirectory.requireCapability` answers a stranger and a colleague differently on
 * purpose, and its own comment says why: "collapsing them would send a moderator who opened
 * the refund console looking for a bug". That is exactly what this component did, because it
 * had the status and not the cause — every screen resolved a 403 to the string `forbidden`
 * and the capability the service had put in `meta` was dropped on the floor between the catch
 * and the render.
 *
 * <p>So the capability travels as a prop beside the status. `useConsoleResource` carries it
 * for the screens that use it; the six that predate that hook keep it in state next to their
 * own.
 *
 * <h2>This was the last component that could not be translated, and why it can be now</h2>
 *
 * `apps/web/README.md` used to list this file as the exception: the signed-out sentence names
 * the thing a screen was about to show, the noun comes from the screen, and while the screens
 * were English literals there was no translated noun to put in it. Every screen carries a
 * catalogue node since #324, so `subject` arrives already translated and already inflected for
 * its position, and the sentence is a template around it rather than a concatenation.
 */
export function ConsoleRefusal({ status, subject, capability, copy }: ConsoleRefusalProps) {
  if (status === 'signed-out') {
    return (
      <InlineAlert variant="info" title={copy.signedOutTitle}>
        {fillPlaceholders(copy.signedOutBody, { subject })}
      </InlineAlert>
    );
  }

  if (status === 'forbidden') {
    // A colleague, on a screen that is not theirs. The service already worked out which of
    // the two this is and said so in `meta.capability`; all this does is not throw it away.
    if (capability != null && capability !== '') {
      return (
        <InlineAlert variant="info" title={copy.capabilityTitle}>
          {`${fillPlaceholders(copy.needsCapability, { subject, capability: capabilityLabel(capability, copy) })} ${copy.capabilityAsk}`}
        </InlineAlert>
      );
    }

    return (
      <InlineAlert variant="info" title={copy.forbiddenTitle}>
        {copy.forbiddenBody}
      </InlineAlert>
    );
  }

  return null;
}
