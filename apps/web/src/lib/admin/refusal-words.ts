import { fillPlaceholders } from '../i18n/placeholders';
import type { ConsoleRefusalsCopy } from '../i18n/admin/common-copy';
import { capabilityLabel, type ConsoleStatus } from './refusals';

/**
 * What a console screen says when the service turned the reader away: a heading and a sentence.
 *
 * <p>The words `ConsoleRefusal` draws, without the kit's alert around them, so a screen that keeps
 * the kit barrel out of its route — the console's front page — can say exactly the same thing in
 * its own markup. An empty alert on the front page was the price of not having this.
 *
 * @returns null for any status that is not a refusal
 */
export function refusalWords(
  status: ConsoleStatus,
  capability: string | null | undefined,
  subject: string,
  copy: ConsoleRefusalsCopy,
): { readonly title: string; readonly body: string } | null {
  if (status === 'signed-out') {
    return { title: copy.signedOutTitle, body: fillPlaceholders(copy.signedOutBody, { subject }) };
  }
  if (status !== 'forbidden') return null;

  // A colleague, on a screen that is not theirs. The service already worked out which of the two
  // this is and said so in `meta.capability`; all this does is not throw it away.
  if (capability != null && capability !== '') {
    return {
      title: copy.capabilityTitle,
      body: `${fillPlaceholders(copy.needsCapability, { subject, capability: capabilityLabel(capability, copy) })} ${copy.capabilityAsk}`,
    };
  }
  return { title: copy.forbiddenTitle, body: copy.forbiddenBody };
}
