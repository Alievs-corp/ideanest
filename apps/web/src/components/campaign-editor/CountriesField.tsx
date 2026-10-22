'use client';

import { useCallback, useMemo } from 'react';
import { Field, InlineAlert, RemovableChip, Select } from '@ideanest/ui';
import type { Locale } from '@ideanest/messages';
import type { BasicsPanelCopy } from '@ideanest/campaign-editor/copy';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import {
  addCountry,
  countryOptions,
  isCountryRemovable,
  removeCountry,
} from '@ideanest/campaign-editor/countries';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { regionNames } from '../../lib/i18n/formats';
import { countryName } from '../checkout/DestinationField';

export interface CountriesFieldProps {
  copy: BasicsPanelCopy;
  locale: Locale;
  project: Pick<ProjectEdit, 'launchedAt' | 'countries'>;
  value: readonly string[];
  error?: string | undefined;
  onChange: (countries: readonly string[]) => void;
}

export function CountriesField({ copy, locale, project, value, error, onChange }: CountriesFieldProps) {
  const display = useMemo(() => regionNames(locale), [locale]);
  const nameOf = useCallback((code: string) => countryName(code, display), [display]);
  const options = useMemo(() => countryOptions(value, nameOf, locale), [value, nameOf, locale]);
  const launched = project.launchedAt !== null && project.launchedAt !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <Field
        label={copy.countries}
        required
        hint={launched ? copy.countriesHintLaunched : copy.countriesHint}
        error={error}
      >
        <Select
          value=""
          placeholder={copy.countriesAdd}
          onChange={(event) => onChange(addCountry(value, event.target.value))}
        >
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>

      <ul className="flex flex-wrap gap-2" aria-label={copy.countries}>
        {value.map((code) => (
          <li key={code}>
            {isCountryRemovable(project, value, code) ? (
              <RemovableChip
                removeLabel={fillPlaceholders(copy.countriesRemove, { name: nameOf(code) })}
                onClick={() => onChange(removeCountry(value, code))}
              >
                {nameOf(code)}
              </RemovableChip>
            ) : (
              <span className="inline-flex h-[34px] items-center rounded-full bg-inverse px-4 text-[13px] font-medium text-on-inverse">
                {nameOf(code)}
              </span>
            )}
          </li>
        ))}
      </ul>

      <InlineAlert variant="info">{copy.countriesDelivery}</InlineAlert>
    </div>
  );
}
