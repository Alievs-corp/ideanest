import { formatDay, formatInstant, formatServerInstant } from './i18n';

/**
 * The campaign page's two dates (#155) — `formatInstant` and `formatDay` in `lib/i18n.tsx`, the
 * web's helpers of the same names, in the device's time zone.
 *
 * <p>Every suite runs in Baku (`jest.config.js`), four hours east of UTC, so a deadline at 20:00
 * UTC is "midnight" here and on the next day — the case a UTC formatter would get wrong.
 */

const DEADLINE = '2026-10-03T20:00:00Z';

describe('formatInstant', () => {
  it('writes the day, the time and the zone in the device’s zone', () => {
    const text = formatInstant(DEADLINE, 'en');
    expect(text).toContain('4 October 2026');
    expect(text).toContain('00:00');
    expect(text).toContain('GMT+4');
  });

  it('writes Azerbaijani through the shared formatter, with the zone named', () => {
    expect(formatInstant(DEADLINE, 'az')).toBe('4 oktyabr 2026/00:00 GMT+4');
  });

  it('answers null for a value that is not an instant', () => {
    expect(formatInstant('not a date', 'en')).toBeNull();
    expect(formatInstant(null, 'en')).toBeNull();
    expect(formatInstant('', 'en')).toBeNull();
  });

  it('writes the same Azerbaijani on Hermes, where format() has no parts', () => {
    jest.isolateModules(() => {
      jest.doMock('@ideanest/messages/hermes', () => ({
        ...jest.requireActual('@ideanest/messages/hermes'),
        formatToPartsWorks: () => ({ numbers: false, dates: false }),
      }));
      const hermes = jest.requireActual<typeof import('./i18n')>('./i18n');
      for (const instant of [DEADLINE, '2026-10-03T05:06:00Z', '2026-12-31T23:59:00Z']) {
        expect(hermes.formatInstant(instant, 'az')).toBe(formatInstant(instant, 'az'));
      }
      expect(hermes.formatInstant('2026-10-03T05:06:00Z', 'az')).toBe('3 oktyabr 2026/09:06 GMT+4');
      expect(hermes.formatDay(DEADLINE, 'az', 'UTC')).toBe('3 oktyabr 2026');
    });
    jest.dontMock('@ideanest/messages/hermes');
  });
});

describe('formatDay', () => {
  it('names the day in the device’s zone, or in UTC where the web prints UTC', () => {
    expect(formatDay(DEADLINE, 'en')).toBe('4 October 2026');
    expect(formatDay(DEADLINE, 'en', 'UTC')).toBe('3 October 2026');
    expect(formatDay(DEADLINE, 'az', 'UTC')).toBe('3 oktyabr 2026');
  });

  it('answers null for a value that is not an instant', () => {
    expect(formatDay('nope', 'en')).toBeNull();
    expect(formatDay(undefined, 'en')).toBeNull();
  });
});

describe('formatServerInstant', () => {
  it('writes UTC whatever the device zone, as the web server does (#164)', () => {
    const text = formatServerInstant(DEADLINE, 'en');
    expect(text).toContain('3 October 2026');
    expect(text).toContain('20:00');
    expect(text).toContain('UTC');
  });

  it('writes the same Azerbaijani on Hermes, where format() has no parts', () => {
    const withParts = formatServerInstant(DEADLINE, 'az');
    expect(withParts).toContain('3 oktyabr 2026');
    expect(withParts).toContain('20:00');
    jest.isolateModules(() => {
      jest.doMock('@ideanest/messages/hermes', () => ({
        ...jest.requireActual('@ideanest/messages/hermes'),
        formatToPartsWorks: () => ({ numbers: false, dates: false }),
      }));
      const hermes = jest.requireActual<typeof import('./i18n')>('./i18n');
      expect(hermes.formatServerInstant(DEADLINE, 'az')).toBe(withParts);
    });
    jest.dontMock('@ideanest/messages/hermes');
  });

  it('answers null for a value that is not an instant', () => {
    expect(formatServerInstant('nope', 'en')).toBeNull();
    expect(formatServerInstant(null, 'az')).toBeNull();
  });
});
