import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The store listing texts (#165): four languages, the same fields in each, every field inside the
 * limit the store enforces — and `store.config.json` exactly what `store-config.js` builds from
 * them. A listing that is one character over is refused at upload, long after review of the copy.
 */

const LOCALES = ['az', 'en', 'ru', 'tr'] as const;

/**
 * Characters, as App Store Connect and Play Console count them. The App Store name is 30, and so is
 * Play's title, so `appName` answers for both.
 */
const LIMITS = {
  appName: 30,
  subtitle: 30,
  promotionalText: 170,
  description: 4000,
  keywords: 100,
  whatsNew: 4000,
  playShortDescription: 80,
  playFullDescription: 4000,
} as const;

type Field = keyof typeof LIMITS;

function listing(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, `${locale}.json`), 'utf8')) as Record<string, unknown>;
}

const length = (text: string): number => [...text].length;

describe.each(LOCALES)('the %s listing', (locale) => {
  const text = listing(locale);

  it('has exactly the fields every other listing has', () => {
    expect(Object.keys(text).sort()).toEqual(Object.keys(LIMITS).sort());
  });

  it.each(Object.keys(LIMITS) as Field[])('keeps %s non-empty and within its limit', (field) => {
    const value = text[field];
    expect(typeof value).toBe('string');
    const content = value as string;
    expect(content.trim()).not.toBe('');
    expect(content).toBe(content.trim());
    expect(length(content)).toBeLessThanOrEqual(LIMITS[field]);
  });

  it('lists keywords once each, without empty entries or the app name', () => {
    const keywords = (text.keywords as string).split(',');
    expect(keywords.every((keyword) => keyword.trim() !== '' && keyword === keyword.trim())).toBe(true);
    expect(new Set(keywords.map((keyword) => keyword.toLocaleLowerCase(locale))).size).toBe(keywords.length);
    expect(keywords.map((keyword) => keyword.toLowerCase())).not.toContain('ideyanest');
  });

  it('never calls a pledge a donation or charity in its keywords — it buys a reward', () => {
    const keywords = (text.keywords as string).toLocaleLowerCase(locale);
    expect(keywords).not.toMatch(/donat|charit|ianə|xeyriyy|пожертв|благотвор|bağış|hayır|сбор|fundrais|invest|инвест|yatırım|sərmayə/);
  });

  it('describes the funding rule as the threshold it is, never all-or-nothing', () => {
    expect(text.description).toMatch(/80/);
    expect(text.playFullDescription).toMatch(/80/);
    expect(String(text.description)).not.toMatch(/all-or-nothing|hamısı ya heç nə|всё или ничего|ya hep ya hiç/i);
  });
});

describe('store.config.json', () => {
  const builder = require('./store-config') as { render: () => string; OUTPUT: string };

  it('is what store-config.js builds from the listings — run `node apps/mobile/store/store-config.js`', () => {
    expect(readFileSync(builder.OUTPUT, 'utf8').replace(/\r\n/g, '\n')).toBe(builder.render());
  });

  it('sends no release notes while the first version is prepared, which App Store Connect refuses', () => {
    const { FIRST_VERSION } = require('./store-config') as { FIRST_VERSION: boolean };
    const config = JSON.parse(builder.render()) as { apple: { info: Record<string, Record<string, unknown>> } };
    for (const info of Object.values(config.apple.info)) {
      if (FIRST_VERSION) expect(info).not.toHaveProperty('releaseNotes');
      else expect(info).toHaveProperty('releaseNotes');
    }
  });

  it('has no Azerbaijani App Store listing, because App Store Connect offers none', () => {
    const config = JSON.parse(builder.render()) as { apple: { info: Record<string, unknown> } };
    expect(Object.keys(config.apple.info).sort()).toEqual(['en-GB', 'ru', 'tr']);
  });
});
