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

  it('writes Azerbaijani in Azerbaijani letters', () => {
    const az = JSON.stringify(COPY.az);
    expect(az).toMatch(/ə/);
    expect(az).not.toMatch(/[äÄ]/);
  });
});
