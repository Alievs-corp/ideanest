'use client';

import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { ALL_MARKETS } from '@ideanest/messages/country';
import { cn, useDismiss } from '@ideanest/ui';
import { useLocale } from '../../i18n/navigation';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ShellCopy } from '../../lib/i18n/shell-copy';
import { currentMarket, writeMarketCookie } from '../../lib/market/cookie';
import { isMarketPage } from '../../lib/market/market';

/*
 * The list of every country is its own chunk, fetched when the control opens: the header is in
 * every page's first load, and two hundred and fifty names are not.
 */
const CountryList = lazy(() => import('./CountryList').then((module) => ({ default: module.CountryList })));

export interface CountrySwitcherProps {
  readonly copy: ShellCopy['market'];
  readonly phoneAlign?: 'end' | 'center' | 'start';
}

const PHONE_ALIGN = {
  end: 'right-0',
  center: 'left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0',
  start: 'left-0 sm:left-auto sm:right-0',
} as const;

/**
 * Which country's campaigns the lists show — issue #533.
 *
 * Beside the language control and built like it: a round button that opens a panel. The button
 * shows the country's code once the page has hydrated, because the market is the reader's (a
 * cookie the proxy reads) and the server render of the header is the same for everybody.
 *
 * Choosing writes the cookie and reloads a page that lists campaigns, so every list on it is
 * read again for the new country; any other page keeps its place.
 */
export function CountrySwitcher({ copy, phoneAlign = 'end' }: CountrySwitcherProps) {
  const locale = useLocale();
  const [market, setMarket] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const uid = useId();
  const triggerId = `${uid}-country`;
  const panelId = `${uid}-countries`;

  useEffect(() => setMarket(currentMarket()), []);

  const close = useCallback(() => setOpen(false), []);
  useDismiss({ open, onDismiss: close });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const node = container.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(next: string): void {
    writeMarketCookie(next);
    setMarket(next);
    setOpen(false);
    if (isMarketPage(window.location.pathname)) window.location.reload();
  }

  const name = market === null ? null : market === ALL_MARKETS ? copy.all : nameOf(market, locale);
  const label = name === null ? copy.label : `${copy.label}. ${fillPlaceholders(copy.current, { name })}`;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'inline-grid size-10 place-items-center rounded-full bg-surface-3 text-white',
          'transition-colors duration-150 ease-in-out hover:bg-surface-4',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
          open && 'bg-surface-4',
        )}
      >
        {market === null || market === ALL_MARKETS ? (
          <MapPin aria-hidden="true" className="size-[18px]" />
        ) : (
          <span aria-hidden="true" className="text-xs font-semibold tracking-wide">
            {market}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={triggerId}
          className={cn(
            'absolute top-[calc(100%+8px)] z-50 w-[260px] rounded-md border border-white/8 bg-surface-2 p-2',
            'shadow-[var(--shadow-panel)]',
            PHONE_ALIGN[phoneAlign],
          )}
        >
          <Suspense fallback={<div aria-hidden="true" className="h-[22rem]" />}>
            <CountryList copy={copy} locale={locale} current={market} onChoose={choose} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/**
 * The country's name for the button's accessible name. `Intl` directly rather than
 * `regionNames`, whose module carries the Azerbaijani formatters into every page's first load
 * for one word; the panel, which loads on demand, uses `regionNames`.
 */
function nameOf(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
