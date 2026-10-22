import { COUNTRY_CODES } from '@ideanest/messages/country';
import type { ProjectEdit } from './contract';

/**
 * The countries a campaign is for: the basics tab's list, as rules both clients share.
 *
 * The list is never empty — a campaign for no country is one nobody can back — and once the
 * campaign has launched the countries it launched with stay, because a backer there was
 * promised a reward there. The service refuses both; these keep the controls from offering
 * what it would refuse.
 */

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

/** Every country not chosen yet, by name in the reader's language. */
export function countryOptions(
  chosen: readonly string[],
  nameOf: (code: string) => string,
  locale: string,
): CountryOption[] {
  const taken = new Set(chosen);
  return COUNTRY_CODES.filter((code) => !taken.has(code))
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((left, right) => left.name.localeCompare(right.name, locale));
}

export function addCountry(chosen: readonly string[], code: string): readonly string[] {
  return code === '' || chosen.includes(code) ? chosen : [...chosen, code];
}

export function removeCountry(chosen: readonly string[], code: string): readonly string[] {
  const rest = chosen.filter((each) => each !== code);
  return rest.length === 0 ? chosen : rest;
}

/** Whether the control may offer to take `code` off the list. */
export function isCountryRemovable(
  project: Pick<ProjectEdit, 'launchedAt' | 'countries'>,
  chosen: readonly string[],
  code: string,
): boolean {
  if (chosen.length <= 1) return false;
  const launched = project.launchedAt !== null && project.launchedAt !== undefined;
  return !(launched && (project.countries ?? []).includes(code));
}
