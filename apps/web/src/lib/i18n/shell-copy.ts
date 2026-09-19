import {
  FOOTER_GROUPS,
  PRIMARY_NAVIGATION,
  type ResolvedFooterGroup,
  type ResolvedNavigationLink,
} from '../../components/shell/navigation';

/**
 * Every word the site shell draws, resolved on the server — issues #324 and #123.
 *
 * <h2>Why the copy is a prop and not a hook</h2>
 *
 * `SiteHeader`, `MobileNavDrawer` and `AccountMenu` are client components: they read the
 * session, they open a drawer, they close a menu on a click outside. The obvious way to give
 * them words is `useTranslations`, and that needs a `NextIntlClientProvider` above them —
 * which means above `SiteShell`, which is every route on the site.
 *
 * `apps/web/README.md` records what that costs, because this repository has measured it:
 * up to **27.4 KiB on every route in a group**, carried by routes that render none of the
 * copy. The catalogue is also not small and grows with each of these, and a provider
 * serialises the whole of it into the HTML for the client to parse.
 *
 * So the words are looked up here, once, on the server, and handed down as a plain object.
 * The client bundle gains the strings it actually renders and nothing else — no catalogue,
 * no provider, no `use-intl` runtime. `AccountArea` established the pattern for the account
 * rail; this is the same move for the shell, and it is the pattern the rest of the
 * application follows.
 *
 * <h2>One object rather than twenty props</h2>
 *
 * A flat prop list would put the whole shell's vocabulary in every component signature and
 * would have to be edited in four files each time a word is added. Grouping by the component
 * that draws it keeps each signature honest about what it needs.
 */
export interface ShellCopy {
  readonly skipToContent: string;
  readonly tagline: string;
  readonly nav: {
    readonly label: string;
    readonly links: readonly ResolvedNavigationLink[];
  };
  readonly drawer: {
    readonly open: string;
    readonly close: string;
    readonly label: string;
  };
  /**
   * The language control, which is in the header as well as the footer since it became an
   * icon. One key read by both, rather than one string spelled twice: the two are the same
   * control, and a reader who meets it in both places should not be told two different
   * things about it.
   */
  readonly language: {
    readonly label: string;
  };
  /**
   * The search box, which is in the bar and in the drawer and is the same control in both.
   *
   * One key rather than three, because the form's landmark name, the input's own label and
   * its placeholder all said the same words before this was translated and there is no
   * reason for them to start disagreeing now. `/search` resolves it from the server too,
   * since the box at the top of the results page is this component as well.
   */
  readonly search: {
    readonly label: string;
  };
  readonly actions: {
    readonly signIn: string;
    readonly register: string;
    readonly signOut: string;
    readonly notifications: string;
    readonly notificationSettings: string;
    /**
     * The reader's own campaigns, drafts included.
     *
     * <p>The menu used to offer only `startCampaign`, which always creates a new
     * draft. A creator who left one half-finished had no route back to it from
     * anywhere in the shell, and pressing the only campaign-shaped row they could
     * see made a second empty draft rather than reopening the first.
     */
    readonly myCampaigns: string;
    readonly profile: string;
    /**
     * The settings index, which replaced a row pointing at `/settings/sessions`.
     *
     * <p>Eight settings pages existed and the menu named one of them. Devices and
     * sessions is not the page somebody opening an account menu is looking for, and
     * naming it made the other seven unreachable from here.
     */
    readonly settings: string;
    readonly startCampaign: string;
    /**
     * The way into the administration console, for staff — issue #405.
     *
     * <p>In the account menu and nowhere else. Signed in as an account holding all four
     * staff roles, `/admin` appeared in neither the header, this menu, nor the footer, so
     * the console was reached by typing a URL. `AccountMenu` carries the argument for why
     * the row is drawn from an answer asked for on open rather than on every page view.
     */
    readonly console: string;
  };
}

/**
 * The floating WhatsApp control and the dialog behind it.
 *
 * <p>Its own interface rather than a branch of `ShellCopy`, for the reason that file's header
 * gives: the header, the drawer and the account menu each take the vocabulary they draw, and
 * handing the enquiry form's field labels to all three would put them in the flight payload of
 * every route on the site whether or not the dialog is ever opened.
 *
 * <p>`handoff` is the state after the link has been followed, and it is deliberately not a
 * success message. `lib/contact/whatsapp.ts` explains why nothing has been sent at that point:
 * the visitor presses send in WhatsApp, from their own number, and an interface that said
 * "sent" would be claiming something it cannot know.
 */
export interface WhatsAppCopy {
  /** Names the icon-only trigger — §9.2 of `docs/ui-kit.md` requires it. */
  readonly open: string;
  readonly title: string;
  /** Says that WhatsApp opens and who presses send. Read before the fields, not after. */
  readonly intro: string;
  readonly fields: {
    readonly firstName: string;
    readonly lastName: string;
    readonly message: string;
  };
  /** One refusal per field, shown beside it. Colour never carries the message (§9.2). */
  readonly errors: {
    readonly firstName: string;
    readonly lastName: string;
    readonly message: string;
  };
  readonly submit: string;
  readonly cancel: string;
  readonly handoff: {
    readonly title: string;
    readonly detail: string;
    /** The same link again, for a browser that refused to open the first one. */
    readonly again: string;
  };
}

/** The three words a failure page offers besides its own heading. */
export interface FailureCopy {
  readonly elsewhere: string;
  readonly links: {
    readonly browse: string;
    readonly categories: string;
    readonly search: string;
  };
}

/** The footer's own words. Resolved separately because `SiteFooter` is a server component. */
export interface FooterCopy {
  readonly label: string;
  readonly tagline: string;
  readonly languageHeading: string;
  /** Names the language control for assistive technology; it is icon-only (§9.2). */
  readonly languageSwitcherLabel: string;
  readonly currencyHeading: string;
  readonly currencyValue: string;
  readonly groups: readonly ResolvedFooterGroup[];
}

/**
 * A message lookup, narrowed to what these builders need.
 *
 * The builders take one rather than calling `getTranslations` themselves so that this module
 * imports nothing from `next-intl/server` — which is what lets a component test build the
 * same object from `messages/*.json` and assert against the words the application will
 * actually draw, instead of against words retyped into the test.
 */
export type ShellTranslator = (key: string) => string;

/**
 * Just the search box's words.
 *
 * `/search` renders `SearchField` outside the shell and needs nothing else from the
 * namespace. `shellCopyFrom` reads the same key, so the two cannot say different things.
 */
export function shellSearchCopyFrom(t: ShellTranslator): ShellCopy['search'] {
  return { label: t('search.label') };
}

export function shellCopyFrom(t: ShellTranslator): ShellCopy {
  return {
    skipToContent: t('skipToContent'),
    tagline: t('tagline'),
    nav: {
      label: t('nav.label'),
      /*
       * The routes live in `components/shell/navigation.ts` and the words live in the
       * catalogue; this is the one place they meet, exactly as `AccountArea` joins
       * `ACCOUNT_GROUPS` to `account.links.*`.
       */
      links: PRIMARY_NAVIGATION.map((link) => ({
        href: link.href,
        label: t(`nav.${link.key}`),
      })),
    },
    drawer: {
      open: t('drawer.open'),
      close: t('drawer.close'),
      label: t('drawer.label'),
    },
    language: { label: t('language.label') },
    search: shellSearchCopyFrom(t),
    actions: {
      signIn: t('actions.signIn'),
      register: t('actions.register'),
      signOut: t('actions.signOut'),
      notifications: t('actions.notifications'),
      notificationSettings: t('actions.notificationSettings'),
      myCampaigns: t('actions.myCampaigns'),
      profile: t('actions.profile'),
      settings: t('actions.settings'),
      startCampaign: t('actions.startCampaign'),
      console: t('actions.console'),
    },
  };
}

export function footerCopyFrom(t: ShellTranslator): FooterCopy {
  return {
    label: t('footer.label'),
    tagline: t('tagline'),
    languageHeading: t('footer.languageHeading'),
    languageSwitcherLabel: t('language.label'),
    currencyHeading: t('footer.currencyHeading'),
    currencyValue: t('footer.currencyValue'),
    groups: FOOTER_GROUPS.map((group) => ({
      heading: t(`footer.groups.${group.headingKey}`),
      links: group.links.map((link) => ({
        href: link.href,
        label: t(`footer.links.${link.key}`),
      })),
    })),
  };
}

export function whatsappCopyFrom(t: ShellTranslator): WhatsAppCopy {
  return {
    open: t('whatsapp.open'),
    title: t('whatsapp.title'),
    intro: t('whatsapp.intro'),
    fields: {
      firstName: t('whatsapp.fields.firstName'),
      lastName: t('whatsapp.fields.lastName'),
      message: t('whatsapp.fields.message'),
    },
    errors: {
      firstName: t('whatsapp.errors.firstName'),
      lastName: t('whatsapp.errors.lastName'),
      message: t('whatsapp.errors.message'),
    },
    submit: t('whatsapp.submit'),
    cancel: t('whatsapp.cancel'),
    handoff: {
      title: t('whatsapp.handoff.title'),
      detail: t('whatsapp.handoff.detail'),
      again: t('whatsapp.handoff.again'),
    },
  };
}

export function failureCopyFrom(t: ShellTranslator): FailureCopy {
  return {
    elsewhere: t('failure.elsewhere'),
    links: {
      browse: t('failure.links.browse'),
      categories: t('failure.links.categories'),
      search: t('failure.links.search'),
    },
  };
}
