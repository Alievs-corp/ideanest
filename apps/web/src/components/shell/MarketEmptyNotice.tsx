'use client';

import { useEffect, useState } from 'react';
import { ALL_MARKETS } from '@ideanest/messages/country';
import { Pill } from '@ideanest/ui';
import { useLocale } from '../../i18n/navigation';
import { regionNames } from '../../lib/i18n/formats';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ShellCopy } from '../../lib/i18n/shell-copy';
import { currentMarket, writeMarketCookie } from '../../lib/market/cookie';

export interface MarketEmptyNoticeProps {
  readonly copy: ShellCopy['market'];
}

/**
 * What an empty list says when it was narrowed to one country — issue #533.
 *
 * A visitor placed in a country by where they are may find nothing there yet. The list says
 * which country it was for and offers every country, so an empty list is never the end of the
 * site. Drawn beside a list's own empty state, and nothing at all when the reader already
 * browses every country.
 */
export function MarketEmptyNotice({ copy }: MarketEmptyNoticeProps) {
  const locale = useLocale();
  const [market, setMarket] = useState<string | null>(null);

  useEffect(() => setMarket(currentMarket()), []);

  if (market === null || market === ALL_MARKETS) return null;

  let name = market;
  try {
    name = regionNames(locale)?.of(market) ?? market;
  } catch {
    // The code stands in for a name the runtime does not have.
  }

  return (
    <div className="rounded-lg border border-white/8 bg-surface-2 px-6 py-8 text-center">
      <p className="text-lg font-medium text-white">{fillPlaceholders(copy.emptyTitle, { name })}</p>
      <p className="mx-auto mt-2 max-w-[52ch] text-white/64">{copy.emptyDetail}</p>
      <Pill
        size="sm"
        variant="ghost"
        className="mt-5"
        onClick={() => {
          writeMarketCookie(ALL_MARKETS);
          window.location.reload();
        }}
      >
        {copy.emptyAction}
      </Pill>
    </div>
  );
}
