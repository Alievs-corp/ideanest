import { describe, expect, it } from 'vitest';
import { COPY, LANGUAGES } from './copy';

const HEADLINES = ['hook', 'show', 'gather', 'montage', 'pledge', 'fundedLine'] as const;

describe('the headline copy', () => {
  it.each(LANGUAGES)('%s has every line the film reads', (lang) => {
    expect(Object.keys(COPY[lang]).sort()).toEqual(Object.keys(COPY.az).sort());
  });

  it.each(LANGUAGES)('%s keeps headlines to two lines of at most five words', (lang) => {
    for (const key of HEADLINES) {
      const lines = COPY[lang][key];
      expect(lines.length, `${lang}.${key}`).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line.split(' ').length, `${lang}.${key}: ${line}`).toBeLessThanOrEqual(5);
        expect(line.trim(), `${lang}.${key}`).toBe(line);
      }
    }
  });

  it.each(LANGUAGES)('%s keeps every headline line inside the 952 px measure', (lang) => {
    // Inter 800 at 112 px fits about 17 Latin or 14 Cyrillic characters across the safe zone;
    // a longer line wraps to a third row (2026-10-12: "Every pledge brings" did). The stills
    // from `scripts/stills.mjs` are the real check; this catches the obvious overrun first.
    for (const key of HEADLINES.filter((k) => k !== 'fundedLine')) {
      for (const line of COPY[lang][key]) {
        const limit = /[Ѐ-ӿ]/.test(line) ? 14 : 17;
        expect(line.length, `${lang}.${key}: ${line}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('writes Azerbaijani in Azerbaijani letters', () => {
    const az = JSON.stringify(COPY.az);
    expect(az).toMatch(/ə/);
    expect(az).not.toMatch(/[äÄ]/);
  });
});
