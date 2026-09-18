/**
 * Every word the administration console's frame draws — issue #324.
 *
 * <h2>The decision this file records</h2>
 *
 * `lib/admin/navigation.ts` used to argue that the console should stay English, on the
 * grounds that §21.1's catalogue is for the product's readers while the console's readers
 * are the few people who operate the platform. That is reversed: the platform is to be
 * legible in all four languages to everybody who uses it, staff included. A moderator who
 * reads Azerbaijani is not a different class of reader from a backer who does.
 *
 * <h2>What this covers, and where the rest of it lives</h2>
 *
 * The frame: the bar, the rail, and the index that lists §4.11's sixteen modules with what
 * each is waiting for. The twenty-six screens inside it are translated too, and their copy is
 * in `lib/i18n/admin/` — one module per group of the rail, resolved by
 * `lib/i18n/admin/console.server.ts` and handed to each screen as a prop.
 *
 * <p>This file stays separate from those because the frame is the one part of the console
 * that is drawn on every route, and because it is keyed by the identifiers the rail itself is
 * built from rather than by a screen's name.
 *
 * <h2>Keyed by the identifiers rather than by a name of its own</h2>
 *
 * A module's words are looked up by its §4.11 code and a rail entry's by its href. Both are
 * already the identifier the specification, the issues and the router agree on, so there is
 * no third name to keep in step — and a destination added to the rail without a label is a
 * missing key rather than a silently English one.
 */
export interface AdminTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** One module's words, as `admin.modules.{code}` holds them. */
export interface ModuleCopy {
  readonly title: string;
  readonly summary: string;
  /** Present exactly when the module's state is not `built`. */
  readonly waitingOn?: string;
}

export interface AdminShellCopy {
  /** The word beside the wordmark. The brand itself is never translated. */
  readonly console: string;
  readonly backToSite: string;
  readonly navLabel: string;
  /** Keyed by `ConsoleGroup.heading`. */
  readonly groups: Readonly<Record<string, string>>;
  /** Keyed by href, which is what a rail entry is. */
  readonly links: Readonly<Record<string, string>>;
  /**
   * Who is reading the console and with what authority — issue #405.
   *
   * <p>Carries `{name}` and `{roles}`. One sentence with two holes rather than a name, a
   * separator and a list: Azerbaijani and Turkish put the verb after both, and three JSX
   * fragments cannot be reordered by a translation.
   */
  readonly signedInAs: string;
  /**
   * The four roles, as ordinary nouns. Keyed by `StaffRole`.
   *
   * <p>The same table `/admin/staff` draws, resolved again here rather than threaded from
   * there: this is the shell and that is a screen inside it, and a shell that took a prop
   * from one of its children would be the wrong way round.
   */
  readonly role: Readonly<Record<string, string>>;
}

export interface ConsoleIndexCopy {
  readonly title: string;
  /**
   * Carries `{total}`, `{complete}` and `{partial}` — issue #405.
   *
   * <p>It used to carry `{built}` and promise that "the rest say what they are waiting for".
   * All sixteen modules have a screen, so there was no rest and the clause described
   * nothing; nine of them are partly built and each does carry a waiting-on note, which is
   * the fact the sentence was reaching for.
   */
  readonly standfirst: string;
  /** Carries `{issue}`. */
  readonly issue: string;
  readonly footnote: string;
  /**
   * How many of §4.11's modules this reader's roles do not open. Carries `{count}` — #295.
   *
   * <p>Worded so that the number can be any number. The catalogue has ICU plurals elsewhere and
   * cannot use one here: console copy is read with `t.raw` and filled by `fillPlaceholders`,
   * which is placeholder substitution and not a message formatter — an ICU form would render as
   * its own source.
   */
  readonly notYours: string;
  /** The link beside it, to the screen that says what each role holds. */
  readonly rolesLink: string;
  /** Keyed by `ModuleState`. Never the only carrier of the state — a tone sits beside it. */
  readonly states: Readonly<Record<string, string>>;
  /** Keyed by §4.11's module code. */
  readonly modules: Readonly<Record<string, ModuleCopy>>;
}

export function adminShellCopyFrom(t: AdminTranslator): AdminShellCopy {
  return {
    console: t('console'),
    backToSite: t('backToSite'),
    navLabel: t('navLabel'),
    groups: t.raw('groups') as Readonly<Record<string, string>>,
    links: t.raw('links') as Readonly<Record<string, string>>,
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument. */
    signedInAs: String(t.raw('signedInAs')),
    role: t.raw('screens.staff.role') as Readonly<Record<string, string>>,
  };
}

export function consoleIndexCopyFrom(t: AdminTranslator): ConsoleIndexCopy {
  return {
    title: t('index.title'),
    standfirst: String(t.raw('index.standfirst')),
    issue: String(t.raw('index.issue')),
    footnote: t('index.footnote'),
    /* `raw` on the first, because next-intl renders a template's own key when it is read with
       `t()` and has no value for the argument — `src/test-copy.ts` refuses the same in tests. */
    notYours: String(t.raw('index.notYours')),
    rolesLink: t('index.rolesLink'),
    states: t.raw('states') as Readonly<Record<string, string>>,
    modules: t.raw('modules') as Readonly<Record<string, ModuleCopy>>,
  };
}
