'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { cn, useDismiss } from '@ideanest/ui';
import { localeHref, useLocale, usePathname } from '../../i18n/navigation';
import { writeLocaleCookie } from '../../lib/i18n/cookie';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';

/**
 * The language control — §4.13 WS-01 and WS-02, issue #123's last mile.
 *
 * <h2>An icon with a list behind it, in the header as well as the footer</h2>
 *
 * It was four links laid out in the footer's bottom row. That is the whole vocabulary of the
 * site written out four times on every page, at the one place a reader arrives last — and in
 * the header, where somebody who landed in the wrong language actually looks, there was
 * nothing at all. A globe is the one control on a page that needs no words to be recognised,
 * which is precisely the point for the reader this exists for: the one who cannot read the
 * page they are on.
 *
 * The names themselves are unchanged and still the whole of the panel. `LOCALE_NAMES` is
 * never translated into the language the page happens to be drawn in — the argument
 * `LanguagePanel` makes at length. "Russian" spelled in Azerbaijani is a dead end for exactly
 * the person who needs this. Each anchor carries its own `lang` so a screen reader pronounces
 * `Русский` with Russian phonemes instead of reading it as mangled English, and `hrefLang`
 * says the same thing to anything that parses the markup.
 *
 * <h2>Built from the kit's hooks rather than from `Popover`</h2>
 *
 * `AccountMenu` makes this argument in full and this is the same component in a different
 * corner: `Popover` lives behind `@ideanest/ui/motion`, this is in the shell, and importing
 * it would put 116 kB of animation runtime into the first load of every page on the site.
 * So the panel is markup and CSS, `useDismiss` handles Escape, and a pointer listener handles
 * a press outside.
 *
 * <p>Nothing animates, and that is not a saving so much as a rule: docs/motion-system.md §5
 * gives the shell §4.7's collapse and nothing else, and §5.1 — "a panel that animates while
 * somebody is using it is a panel that is slower to use" — applies to a menu more than to
 * anything.
 *
 * <h2>A disclosure, not an ARIA menu</h2>
 *
 * `AccountMenu`'s reasoning again: a button with `aria-expanded`/`aria-controls` revealing
 * ordinary links behaves the way the browser already behaves, and every row stays a real link
 * that can be opened in a new tab. The panel takes its accessible name from the button, so
 * the control is named once.
 *
 * <h2>Anchors, not `Link`, and the guard test knows</h2>
 *
 * `Link` from `src/i18n/navigation` keeps the CURRENT language, which is exactly the wrong
 * behaviour here — it would render four links to the page you are already on. So these are
 * plain anchors that prefix the path themselves with `localeHref`, which is the exception
 * `navigation.guard.test.ts` allows and checks for.
 *
 * A full-document navigation is also the honest mechanism. Everything a language changes is
 * server-rendered — the shell, the navigation, the page body, the `<html lang>` — so there is
 * no client state worth carrying across, and a soft navigation would only make the swap look
 * partial while it happened.
 *
 * <h2>The cookie is written, and it is not what makes the switch work</h2>
 *
 * The link does that on its own. The cookie is the one job `proxy.ts` left it: answering the
 * bare path. Somebody who chooses Russian here and later arrives at `/` should be sent to
 * `/ru` rather than to whatever they had before, and without this write that redirect keeps
 * answering with a preference this control has just contradicted.
 *
 * <h2>The query string is deliberately dropped</h2>
 *
 * Reading it would mean `useSearchParams`, and a component that calls it sits on every route
 * in the shell — which opts those routes out of static rendering unless each one wraps this in
 * its own `Suspense` boundary. That is the whole of #123 undone to keep a filter across a
 * language change. The path is preserved; `/ru/discover?sort=ending` becomes `/ru/discover`.
 */

export interface LanguageSwitcherProps {
  /** Names the control. It is icon-only, so §9.2 makes this required rather than optional. */
  readonly label: string;
  /**
   * Which way the panel opens. `up` in the footer, where there is no room below it.
   *
   * A measured placement would mean `Popover`'s geometry, and this is one control with two
   * known positions — both of them fixed by the surface it sits on rather than by the
   * viewport.
   */
  readonly placement?: 'down' | 'up';
  /**
   * `bar` fills the trigger the way the header's other round controls are filled; `quiet`
   * leaves it unfilled, for the footer's rule of small type.
   */
  readonly appearance?: 'bar' | 'quiet';
  /** On the wrapper. The header uses it to keep the icon off a phone's action row. */
  readonly className?: string;
}

const ROW = [
  'flex items-center justify-between gap-3 rounded-sm px-3 py-2.5 text-sm',
  'transition-colors duration-150 ease-in-out hover:bg-surface-3 hover:text-white',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
].join(' ');

export function LanguageSwitcher({
  label,
  placement = 'down',
  appearance = 'bar',
  className,
}: LanguageSwitcherProps) {
  const current = useLocale();
  const path = usePathname();

  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const uid = useId();
  const triggerId = `${uid}-language`;
  const panelId = `${uid}-languages`;

  const close = useCallback(() => setOpen(false), []);
  useDismiss({ open, onDismiss: close });

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const node = container.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    }

    /*
     * `pointerdown` rather than `click`, and on the document rather than on a backdrop —
     * `AccountMenu` carries the reasoning. There is no backdrop: a menu this small must not
     * put a blocking layer over the page.
     */
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={container} className={cn('relative', className)}>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'inline-grid place-items-center rounded-full',
          'transition-colors duration-150 ease-in-out',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
          appearance === 'bar'
            ? 'size-10 bg-surface-3 text-white hover:bg-surface-4'
            : 'size-8 text-white/64 hover:bg-surface-2 hover:text-white',
          open && (appearance === 'bar' ? 'bg-surface-4' : 'bg-surface-2 text-white'),
        )}
      >
        <Globe aria-hidden="true" className={appearance === 'bar' ? 'size-[18px]' : 'size-4'} />
      </button>

      {open && (
        /*
         * Named by the button rather than by a second copy of the same string: one control,
         * one name. `right-0` on both placements — this sits at the right-hand end of the
         * header's action row and of the footer's bottom row, so a panel anchored left would
         * open off the edge of a phone.
         */
        <nav
          id={panelId}
          aria-labelledby={triggerId}
          className={cn(
            'absolute right-0 z-50 w-[200px] rounded-md border border-white/8 bg-surface-2 p-2',
            'shadow-[var(--shadow-panel)]',
            placement === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]',
          )}
        >
          <LanguageLinks current={current} path={path} />
        </nav>
      )}
    </div>
  );
}

/**
 * The four anchors, which are the whole of this control wherever it is drawn.
 *
 * Exported because the mobile drawer draws them flat rather than behind a second disclosure:
 * a panel that opens inside a panel is one a phone has no room for, and the drawer is already
 * a list of links. `SiteHeader` keeps the icon for every width the action row can hold it at.
 */
export function LanguageLinks({
  current,
  path,
  onChosen,
}: {
  readonly current: Locale;
  readonly path: string;
  /** The drawer closes itself on a choice, the way it does for every other link in it. */
  readonly onChosen?: () => void;
}) {
  return (
    <ul className="list-none">
      {SUPPORTED_LOCALES.map((locale: Locale) => {
        const active = locale === current;

        return (
          <li key={locale}>
            <a
              href={localeHref(path, locale)}
              lang={locale}
              hrefLang={locale}
              /*
               * `page` rather than `true`: this is a set of links to the same page in other
               * languages, and the one that is current IS the page being read.
               */
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                writeLocaleCookie(locale);
                onChosen?.();
              }}
              className={cn(ROW, active ? 'text-white' : 'text-white/64')}
            >
              {LOCALE_NAMES[locale]}
              {/*
                The tick is the second carrier of a state `aria-current` already announces,
                because §9.2 forbids colour from being the only one — and between `text-white`
                and `text-white/64` colour is exactly what the rest of the row has.
              */}
              {active && <Check aria-hidden="true" className="size-4 shrink-0" />}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
