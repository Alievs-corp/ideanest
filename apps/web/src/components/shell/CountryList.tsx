'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { ALL_MARKETS, COUNTRY_CODES } from '@ideanest/messages/country';
import { TextInput, cn } from '@ideanest/ui';
import type { Locale } from '../../lib/i18n/locale';
import { regionNames } from '../../lib/i18n/formats';
import type { ShellCopy } from '../../lib/i18n/shell-copy';

export interface CountryListProps {
  readonly copy: ShellCopy['market'];
  readonly locale: Locale;
  readonly current: string | null;
  readonly onChoose: (market: string) => void;
}

const ROW = [
  'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2.5 text-left text-sm',
  'transition-colors duration-150 ease-in-out hover:bg-surface-3 hover:text-white',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
].join(' ');

/** Every country by name in the reader's language, with a filter and every country on top. */
export function CountryList({ copy, locale, current, onChoose }: CountryListProps) {
  const [filter, setFilter] = useState('');

  const countries = useMemo(() => {
    const display = regionNames(locale);
    return COUNTRY_CODES.map((code) => {
      let name = code;
      try {
        name = display?.of(code) ?? code;
      } catch {
        // A code the runtime has no name for is shown as the code.
      }
      return { code, name };
    }).sort((left, right) => left.name.localeCompare(right.name, locale));
  }, [locale]);

  const needle = filter.trim().toLocaleLowerCase(locale);
  const shown =
    needle === ''
      ? countries
      : countries.filter(
          (country) =>
            country.name.toLocaleLowerCase(locale).includes(needle) || country.code.toLowerCase() === needle,
        );

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        size="sm"
        aria-label={copy.filter}
        placeholder={copy.filter}
        value={filter}
        autoComplete="off"
        onChange={(event) => setFilter(event.target.value)}
      />
      <ul className="max-h-80 list-none overflow-y-auto">
        {needle === '' && (
          <li>
            <Row label={copy.all} active={current === ALL_MARKETS} onClick={() => onChoose(ALL_MARKETS)} />
          </li>
        )}
        {shown.map((country) => (
          <li key={country.code}>
            <Row label={country.name} active={current === country.code} onClick={() => onChoose(country.code)} />
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-white/64">{copy.noMatch}</li>}
      </ul>
    </div>
  );
}

function Row({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(ROW, active ? 'text-white' : 'text-white/64')}
    >
      {label}
      {active && <Check aria-hidden="true" className="size-4 shrink-0" />}
    </button>
  );
}
