import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, isLocale, localeForCountry } from './index';

/** Every dotted key path in a catalogue, leaves only. */
function keys(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix === '' ? k : `${prefix}.${k}`),
  );
}

const raw = (locale: string) => readFileSync(join(__dirname, `${locale}.json`), 'utf8');

describe('the shared catalogues', () => {
  it.each(SUPPORTED_LOCALES)('%s parses and round-trips through JSON.stringify with CRLF', (locale) => {
    const text = raw(locale).replace(/\r\n/g, '\n');
    expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`).toBe(text);
  });

  it('has the same key set in all four languages', () => {
    const [first, ...rest] = SUPPORTED_LOCALES.map((l) => keys(JSON.parse(raw(l))).sort());
    for (const other of rest) expect(other).toEqual(first);
  });
});

describe('the locale vocabulary', () => {
  it('recognises the four and nothing else', () => {
    expect(SUPPORTED_LOCALES.every((l) => isLocale(l))).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it('maps a country to a language through the web table', () => {
    expect(localeForCountry('az')).toBe('az');
    expect(localeForCountry('KZ')).toBe('ru');
    expect(localeForCountry('US')).toBeNull();
  });
});
