import type { AdminTranslator } from '../admin-copy';

/**
 * The words every console screen repeats — issue #324, epic #259.
 *
 * <h2>Why the refusals are one table rather than a table per screen</h2>
 *
 * `lib/admin/refusals.ts` already made this argument about the code and it applies unchanged
 * to the copy: twenty-six screens meet the same four outcomes — it worked, the browser has no
 * session, the account is not staff, or something else went wrong — and twenty-six copies of
 * those sentences means the twenty-fifth is the one nobody teaches about a new refusal code.
 * One table, keyed by §10.4's codes, so a code the service adds is a key somebody adds once.
 *
 * <h2>There are two 403s, and #400 is what it costs to render only one of them</h2>
 *
 * `StaffDirectory.requireCapability` separates them deliberately — "a stranger is told they do
 * not work here; a colleague is told which authority this screen wanted" — and the console
 * rendered `forbiddenBody` for both. So a moderator opening the payout queue was told they were
 * not a moderator, on a screen they had reached from a console that had just loaded the
 * moderation queue for them, and the sentence went on to explain a role model the platform
 * replaced in #295. Three wrong statements in four lines, in front of somebody who had done
 * nothing but open a URL.
 *
 * <p>So `capabilityTitle` and `capabilityAsk` head and close the sentence `needsCapability`
 * already was, and `forbiddenBody` is now only about standing. The capability itself is drawn
 * as its own identifier — `VIEW_FINANCE` — for the reason `people-copy.ts` records: it is what
 * a member of staff asks an administrator for and what the service names back at them, so a
 * translated one would be a word nothing else in the system answers to.
 *
 * <h2>The 403s carry `{subject}`, and that is what unblocked `ConsoleRefusal`</h2>
 *
 * `apps/web/README.md` recorded `ConsoleRefusal` as the one component that could not be
 * translated on its own: its sentence names the thing a screen was about to show — "…to read
 * the audit trail" — and the noun belongs to the screen rather than to the component. That was
 * true while the screens were English literals and stopped being true the moment each of them
 * gained a catalogue node. Every screen now hands over its own `subject`, already translated
 * and already in whatever case its language needs, and the sentence is a template around it.
 *
 * <p>Which is also why `subject` is a whole noun phrase and never a stem with an article or a
 * suffix bolted on here. "the ledger" is `baş kitabı` in Azerbaijani and `defteri` in Turkish,
 * both of them already inflected for the position they sit in; a component that tried to build
 * that would be writing grammar for four languages in TypeScript.
 */
/**
 * What the console says when it names something — issue #402.
 *
 * <p>On the chrome rather than on each screen, because the alternative is nine copies of
 * the word "Copy" and nine chances for the eighth to be the one nobody translated. It is
 * the same argument the refusal table makes one field down, and the same one that put
 * `Save` in the root `common` namespace rather than in the console's.
 *
 * <p><strong>Nothing here names a kind of thing.</strong> "Copy" is a control, not a
 * sentence about accounts — the screen supplies the noun, exactly as it supplies
 * {@link ConsoleRefusalsCopy}'s `subject`, because "the campaign" is already inflected for
 * its position in the two languages that inflect it.
 */
export interface ConsoleIdentityCopy {
  /** The control that puts a whole identifier on the clipboard. One word: it ends a row. */
  readonly copy: string;
  /**
   * Its accessible name. Carries `{id}`.
   *
   * <p>A list of twenty-five controls all named "Copy" is a list nobody can navigate by
   * name, so the shortened identifier goes into the name rather than only onto the row.
   */
  readonly copyLabel: string;
  /** Announced when the clipboard took it — colour is never the only signal. */
  readonly copied: string;
}

export interface ConsoleChromeCopy {
  /** The heading over a failure that is not one of the two refusals. */
  readonly errorTitle: string;
  readonly loadMore: string;
  /** The pager, on the four screens the service pages rather than cursors. */
  readonly previous: string;
  readonly next: string;
  /** The load-more control while it is loading. Never the only signal — the control disables. */
  readonly loading: string;
  readonly tryAgain: string;
  readonly save: string;
  readonly saving: string;
  readonly cancel: string;
  readonly refusals: ConsoleRefusalsCopy;
  /** How an identifier is named and copied, on every screen that renders one — #402. */
  readonly identity: ConsoleIdentityCopy;
  /** How a list says how many rows it is showing, on the five that page — #404. */
  readonly count: ConsoleCountCopy;
}

/**
 * The badge beside a list's heading.
 *
 * <p>Two forms rather than one, because the number means two different things: on a list
 * that has reached its end it is the population, and on one that has not it is the page.
 * `ConsoleCount` has the whole argument, including why this is not a real total.
 */
export interface ConsoleCountCopy {
  /** The whole list is loaded. Carries `{count}`. */
  readonly exact: string;
  /** There are more rows behind these. Carries `{count}`. */
  readonly partial: string;
  /** {@link exact} in words, for the accessible name. Carries `{count}`. */
  readonly exactLabel: string;
  /** {@link partial} in words — the plus sign must not be the only thing that says it. */
  readonly partialLabel: string;
}

export interface ConsoleRefusalsCopy {
  /**
   * The console itself, as the noun the two shell refusals take - `ConsoleGate`.
   *
   * <p>It is here rather than on the shell's own copy because it is a `subject` like every
   * other: already inflected for its position in the two languages that inflect it, and read
   * by the one refusal that is about the whole console rather than about a screen.
   */
  readonly consoleSubject: string;
  readonly signedOutTitle: string;
  /** Carries `{subject}`. */
  readonly signedOutBody: string;
  /** The 403 that is about standing rather than authority: a stranger. */
  readonly forbiddenTitle: string;
  readonly forbiddenBody: string;
  /** The 403 with no capability in it. Carries `{subject}`. */
  readonly notStaff: string;
  /** The 403 that names one, since #295. Carries `{subject}` and `{capability}`. */
  readonly needsCapability: string;
  /** The heading over {@link needsCapability} — a colleague, on a screen that is not theirs. */
  readonly capabilityTitle: string;
  /** What to do about it. The capability is named, so the ask is a sentence rather than a hunt. */
  readonly capabilityAsk: string;
  readonly unknownLedgerAccount: string;
  readonly collectionNotFound: string;
  readonly collectionSlugTaken: string;
  readonly curationRejected: string;
  readonly refused: string;
  readonly unreachable: string;
}

/**
 * `NoteDialog`'s own words.
 *
 * The labels above them — what is about to happen, and what the confirm control says — stay
 * with the screen that opens the dialog, because they name the change rather than the note.
 */
export interface NoteDialogCopy {
  readonly why: string;
  readonly hint: string;
  readonly required: string;
  /** Carries `{limit}`. */
  readonly tooLong: string;
  readonly cancel: string;
}

/**
 * The chrome, which every screen's own copy extends.
 *
 * <p>Spreading it into each screen's object rather than passing a second prop is what keeps
 * twenty-six components taking exactly one `copy`. The alternative — `copy` and `chrome` and
 * `refusals` — is three props that are always passed together and always resolved together,
 * which is one object wearing a disguise.
 *
 * @param t the `admin` namespace
 * @param common the root `common` namespace, which already owns the four words the whole
 *     product shares. A second spelling of "Save" in the console is a second spelling to
 *     translate and a second one to get wrong
 */
export function consoleChromeCopyFrom(t: AdminTranslator, common: AdminTranslator): ConsoleChromeCopy {
  return {
    errorTitle: t('common.errorTitle'),
    loadMore: t('common.loadMore'),
    previous: t('common.previous'),
    next: t('common.next'),
    loading: t('common.loading'),
    tryAgain: common('tryAgain'),
    save: common('save'),
    saving: common('saving'),
    cancel: common('cancel'),
    refusals: consoleRefusalsCopyFrom(t),
    identity: consoleIdentityCopyFrom(t),
    count: consoleCountCopyFrom(t),
  };
}

export function consoleCountCopyFrom(t: AdminTranslator): ConsoleCountCopy {
  return {
    /* `raw` on all four, because next-intl renders a template's own key when it is read with
       `t()` and has no value for the argument — `src/test-copy.ts` refuses the same mistake
       in tests. */
    exact: String(t.raw('common.count.exact')),
    partial: String(t.raw('common.count.partial')),
    exactLabel: String(t.raw('common.count.exactLabel')),
    partialLabel: String(t.raw('common.count.partialLabel')),
  };
}

export function consoleIdentityCopyFrom(t: AdminTranslator): ConsoleIdentityCopy {
  return {
    copy: t('common.identity.copy'),
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument — `src/test-copy.ts` refuses the same mistake in tests. */
    copyLabel: String(t.raw('common.identity.copyLabel')),
    copied: t('common.identity.copied'),
  };
}

export function consoleRefusalsCopyFrom(t: AdminTranslator): ConsoleRefusalsCopy {
  return {
    consoleSubject: t('refusals.consoleSubject'),
    signedOutTitle: t('refusals.signedOutTitle'),
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument — `src/test-copy.ts` refuses the same mistake in tests. */
    signedOutBody: String(t.raw('refusals.signedOutBody')),
    forbiddenTitle: t('refusals.forbiddenTitle'),
    forbiddenBody: t('refusals.forbiddenBody'),
    notStaff: String(t.raw('refusals.notStaff')),
    needsCapability: String(t.raw('refusals.needsCapability')),
    capabilityTitle: t('refusals.capabilityTitle'),
    capabilityAsk: t('refusals.capabilityAsk'),
    unknownLedgerAccount: t('refusals.unknownLedgerAccount'),
    collectionNotFound: t('refusals.collectionNotFound'),
    collectionSlugTaken: t('refusals.collectionSlugTaken'),
    curationRejected: t('refusals.curationRejected'),
    refused: t('refusals.refused'),
    unreachable: t('refusals.unreachable'),
  };
}

export function noteDialogCopyFrom(t: AdminTranslator, common: AdminTranslator): NoteDialogCopy {
  return {
    why: t('note.why'),
    hint: t('note.hint'),
    required: t('note.required'),
    tooLong: String(t.raw('note.tooLong')),
    cancel: common('cancel'),
  };
}
