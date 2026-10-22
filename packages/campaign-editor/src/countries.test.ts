import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '@ideanest/messages/country';
import { addCountry, countryOptions, isCountryRemovable, removeCountry } from './countries';

const NAMES: Record<string, string> = { AZ: 'Azerbaijan', TR: 'Türkiye', GE: 'Georgia' };
const nameOf = (code: string) => NAMES[code] ?? code;

describe('countryOptions', () => {
  it('offers every country not chosen yet, by name', () => {
    const options = countryOptions(['AZ'], nameOf, 'en');
    expect(options).toHaveLength(COUNTRY_CODES.length - 1);
    expect(options.map((option) => option.code)).not.toContain('AZ');
    const georgia = options.findIndex((option) => option.code === 'GE');
    const turkey = options.findIndex((option) => option.code === 'TR');
    expect(georgia).toBeLessThan(turkey);
  });
});

describe('adding and removing', () => {
  it('adds a country once, at the end', () => {
    expect(addCountry(['AZ'], 'TR')).toEqual(['AZ', 'TR']);
    expect(addCountry(['AZ', 'TR'], 'TR')).toEqual(['AZ', 'TR']);
    expect(addCountry(['AZ'], '')).toEqual(['AZ']);
  });

  it('never removes the last country', () => {
    expect(removeCountry(['AZ', 'TR'], 'AZ')).toEqual(['TR']);
    expect(removeCountry(['AZ'], 'AZ')).toEqual(['AZ']);
  });
});

describe('isCountryRemovable', () => {
  const draft = { launchedAt: null, countries: ['AZ', 'TR'] };
  const live = { launchedAt: '2026-10-01T09:00:00.000Z', countries: ['AZ'] };

  it('offers removal in a draft while more than one is chosen', () => {
    expect(isCountryRemovable(draft, ['AZ', 'TR'], 'AZ')).toBe(true);
    expect(isCountryRemovable(draft, ['AZ'], 'AZ')).toBe(false);
  });

  it('keeps every country a live campaign has saved, and lets it drop one not saved yet', () => {
    expect(isCountryRemovable(live, ['AZ', 'TR'], 'AZ')).toBe(false);
    expect(isCountryRemovable(live, ['AZ', 'TR'], 'TR')).toBe(true);
  });
});
