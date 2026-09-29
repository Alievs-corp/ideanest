import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LOCALES } from '../api/config';
import { PLEDGE_STATE_LABELS, readablePledgeState } from './pledge-states';

/**
 * Every state the service can send, read from the service rather than retyped —
 * issue #180.
 *
 * The Java enum is the source; `openapi.json` is what the generated types are
 * built from. Both are read, so a state added on the server fails here whichever
 * of the two a pull request remembered to update.
 */
const API = join(__dirname, '../../../api');
const WEB_MESSAGES = join(__dirname, '../../../web/messages');

function javaEnumConstants(): string[] {
  const source = readFileSync(
    join(API, 'src/main/java/az/ideanest/pledge/domain/PledgeState.java'),
    'utf8',
  );
  // Comments first: a Javadoc above a constant can carry a `;`, which would end the match early.
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
  const body = /public enum PledgeState \{([\s\S]*?);/u.exec(code)?.[1] ?? '';
  return body
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

const CONTRACT = JSON.parse(readFileSync(join(API, 'openapi.json'), 'utf8')) as {
  components: {
    schemas: { BackerFilterBody: { properties: { states: { items: { enum: string[] } } } } };
  };
};

describe('pledge state labels', () => {
  const JAVA = javaEnumConstants();

  it('read the Java enum rather than nothing', () => {
    expect(JAVA).toContain('CHARGEBACK');
    expect(JAVA.length).toBeGreaterThanOrEqual(12);
  });

  it.each(SUPPORTED_LOCALES)('cover exactly the Java enum in %s', (locale) => {
    expect(Object.keys(PLEDGE_STATE_LABELS[locale]).sort()).toEqual([...JAVA].sort());
  });

  it('cover exactly the enum the contract publishes', () => {
    const published = CONTRACT.components.schemas.BackerFilterBody.properties.states.items.enum;
    expect(Object.keys(PLEDGE_STATE_LABELS.en).sort()).toEqual([...published].sort());
  });

  /**
   * The same words as the web, not a second translation of them. A backer who reads
   * "Charged back" on a phone and something else in a browser has two answers to one question.
   */
  it.each(SUPPORTED_LOCALES)("match the web's wording in %s", (locale) => {
    const catalogue = JSON.parse(readFileSync(join(WEB_MESSAGES, `${locale}.json`), 'utf8')) as {
      account: { pledges: { states: Record<string, string> } };
    };
    expect(PLEDGE_STATE_LABELS[locale]).toEqual(catalogue.account.pledges.states);
  });

  it.each(SUPPORTED_LOCALES)('never print a raw state name in %s', (locale) => {
    for (const state of JAVA) {
      const label = readablePledgeState(state, locale);
      expect(label).not.toBe(state);
      expect(label.trim()).not.toBe('');
    }
  });
});

describe('readablePledgeState', () => {
  it('names a chargeback, which the old list printed as CHARGEBACK', () => {
    expect(readablePledgeState('CHARGEBACK', 'en')).toBe('Charged back');
  });

  it("uses the device's language by default", () => {
    // `jest.setup.ts` gives the device Azerbaijani.
    expect(readablePledgeState('CONFIRMED')).toBe('Təsdiqlənib');
  });

  it('prints a state this build does not know as itself', () => {
    expect(readablePledgeState('ON_HOLD', 'en')).toBe('ON_HOLD');
  });

  it('does not treat an inherited property as a state', () => {
    expect(readablePledgeState('toString', 'en')).toBe('toString');
  });

  it('answers an empty string for a missing state', () => {
    expect(readablePledgeState(undefined, 'en')).toBe('');
  });
});
