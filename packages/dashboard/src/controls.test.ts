import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import {
  CONTROL_STATES,
  CLOSING_WINDOW_DAYS,
  controlsOffer,
  EXTENSION_OPENS_BEFORE_DAYS,
  extensionUntil,
  extensionWindow,
  isExtensionDay,
  percentOf,
  refusalOf,
  type ControlsRefusal,
} from './controls';

const DEADLINE = '2026-09-19T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Four days before the deadline: inside the window the service accepts an extension in. */
const IN_WINDOW = Date.parse(DEADLINE) - 4 * DAY_MS;

const EVERY_STATE = [
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'PRELAUNCH',
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'FULFILLING',
  'COMPLETED',
  'WITHDRAWN',
  'CANCELED',
  'SUSPENDED',
];

describe('which states show the controls', () => {
  it('is live, in its closing window, extended or successful, and nothing else', () => {
    const shown = EVERY_STATE.filter((state) => controlsOffer(state, 90, DEADLINE, IN_WINDOW).shown);
    expect(shown).toEqual(['LIVE', 'CLOSING_WINDOW', 'EXTENDED', 'SUCCESSFUL']);
    expect([...CONTROL_STATES]).toEqual(shown);
  });

  it('offers nothing at all in a state with nothing left to decide', () => {
    expect(controlsOffer('WITHDRAWN', 95, DEADLINE, IN_WINDOW)).toEqual({
      shown: false,
      canExtend: false,
      canWithdraw: false,
      belowThreshold: false,
      extendOpensAt: null,
    });
  });
});

describe('withdrawing', () => {
  it('is offered at exactly 80%, and not a hundredth below it', () => {
    expect(controlsOffer('LIVE', 80, DEADLINE, IN_WINDOW).canWithdraw).toBe(true);
    expect(controlsOffer('LIVE', '80.00', DEADLINE, IN_WINDOW).canWithdraw).toBe(true);
    expect(controlsOffer('LIVE', 79.99, DEADLINE, IN_WINDOW).canWithdraw).toBe(false);
    expect(controlsOffer('LIVE', 79.99, DEADLINE, IN_WINDOW).belowThreshold).toBe(true);
  });

  /** The float that `0.7 * 100 + 10` and friends produce; a decimal compare is not fooled by it. */
  it('compares the digits it was sent, not a float near them', () => {
    expect(controlsOffer('LIVE', 79.99999999999999, DEADLINE, IN_WINDOW).canWithdraw).toBe(false);
    expect(controlsOffer('LIVE', '80.000000000000000001', DEADLINE, IN_WINDOW).canWithdraw).toBe(true);
  });

  it('is offered in all four states that show the card', () => {
    for (const state of CONTROL_STATES) expect(controlsOffer(state, 85, DEADLINE, IN_WINDOW).canWithdraw).toBe(true);
  });

  it('treats a campaign with no goal as below the threshold', () => {
    expect(controlsOffer('LIVE', null, DEADLINE, IN_WINDOW)).toMatchObject({ canWithdraw: false, belowThreshold: true });
  });
});

describe('extending', () => {
  it('is offered at exactly 50% while live or in the closing window', () => {
    expect(controlsOffer('LIVE', 50, DEADLINE, IN_WINDOW).canExtend).toBe(true);
    expect(controlsOffer('CLOSING_WINDOW', '50.00', DEADLINE, IN_WINDOW).canExtend).toBe(true);
    expect(controlsOffer('LIVE', 49.99, DEADLINE, IN_WINDOW).canExtend).toBe(false);
  });

  it('is not offered once extended, once successful, or without a deadline', () => {
    expect(controlsOffer('EXTENDED', 90, DEADLINE, IN_WINDOW).canExtend).toBe(false);
    expect(controlsOffer('SUCCESSFUL', 120, DEADLINE, IN_WINDOW).canExtend).toBe(false);
    expect(controlsOffer('LIVE', 90, null, IN_WINDOW).canExtend).toBe(false);
  });
});

describe('the window an extension is accepted in (#619)', () => {
  const at = Date.parse(DEADLINE);
  const opens = at - EXTENSION_OPENS_BEFORE_DAYS * DAY_MS;
  const closes = at + CLOSING_WINDOW_DAYS * DAY_MS;

  it('matches the service: seven days before the first deadline to seven days after', () => {
    expect(EXTENSION_OPENS_BEFORE_DAYS).toBe(7);
    expect(CLOSING_WINDOW_DAYS).toBe(7);
  });

  it('is not offered before it opens, and says when it does', () => {
    const early = controlsOffer('LIVE', 62, DEADLINE, opens - 1);
    expect(early.canExtend).toBe(false);
    expect(early.extendOpensAt).toBe('2026-09-12T12:00:00.000Z');
    // Twenty-five days out, as the owner's case was.
    expect(controlsOffer('LIVE', 62, DEADLINE, at - 25 * DAY_MS).extendOpensAt).toBe('2026-09-12T12:00:00.000Z');
  });

  it('opens at exactly seven days before, and stays open in the closing window', () => {
    expect(controlsOffer('LIVE', 62, DEADLINE, opens)).toMatchObject({ canExtend: true, extendOpensAt: null });
    expect(controlsOffer('CLOSING_WINDOW', 62, DEADLINE, at + 3 * DAY_MS).canExtend).toBe(true);
    expect(controlsOffer('CLOSING_WINDOW', 62, DEADLINE, closes - 1).canExtend).toBe(true);
  });

  it('closes when the closing window ends, without promising anything', () => {
    expect(controlsOffer('CLOSING_WINDOW', 62, DEADLINE, closes)).toMatchObject({
      canExtend: false,
      extendOpensAt: null,
    });
  });

  it('names no opening day for a campaign that could not extend anyway', () => {
    expect(controlsOffer('LIVE', 49.99, DEADLINE, opens - DAY_MS).extendOpensAt).toBeNull();
    expect(controlsOffer('EXTENDED', 90, DEADLINE, opens - DAY_MS).extendOpensAt).toBeNull();
    expect(controlsOffer('SUCCESSFUL', 120, DEADLINE, opens - DAY_MS).extendOpensAt).toBeNull();
    expect(controlsOffer('LIVE', 90, null, opens - DAY_MS).extendOpensAt).toBeNull();
  });
});

describe('the new deadline', () => {
  const window = extensionWindow(DEADLINE);

  it('runs from the day after the deadline to sixty days after it, at the deadline’s time', () => {
    expect(window).toEqual({
      deadlineDay: '2026-09-19',
      firstDay: '2026-09-20',
      latestDay: '2026-11-18',
      timeOfDay: 'T12:00:00.000Z',
    });
    expect(extensionWindow(null)).toBeNull();
    expect(extensionWindow('soon')).toBeNull();
  });

  it('accepts both ends and nothing outside them', () => {
    expect(isExtensionDay('2026-09-20', window)).toBe(true);
    expect(isExtensionDay('2026-11-18', window)).toBe(true);
    expect(isExtensionDay('2026-09-19', window)).toBe(false);
    expect(isExtensionDay('2026-11-19', window)).toBe(false);
    expect(isExtensionDay('', window)).toBe(false);
    expect(isExtensionDay('2026-10-01', null)).toBe(false);
  });

  it('is sent at the deadline’s own time of day', () => {
    expect(window === null ? null : extensionUntil('2026-10-01', window)).toBe('2026-10-01T12:00:00.000Z');
  });
});

describe('refusals', () => {
  it.each([
    [{ code: 'EXTENSION_NOT_AVAILABLE', meta: { reason: 'ALREADY_EXTENDED' } }, 'extendAlready'],
    [{ code: 'EXTENSION_NOT_AVAILABLE', meta: { reason: 'OUTSIDE_WINDOW' } }, 'extendOutsideWindow'],
    [{ code: 'EXTENSION_NOT_AVAILABLE', meta: { reason: 'BELOW_THRESHOLD' } }, 'extendBelow'],
    [{ code: 'EXTENSION_NOT_AVAILABLE', meta: { reason: 'WRONG_STATE' } }, 'extendWrongState'],
    [{ code: 'EXTENSION_NOT_AVAILABLE' }, 'extendWrongState'],
    [{ code: 'PROJECT_FIELD_INVALID', meta: { field: 'until' } }, 'extendDate'],
    [{ code: 'WITHDRAWAL_NOT_AVAILABLE', meta: { reason: 'BELOW_THRESHOLD' } }, 'belowThreshold'],
    [{ code: 'WITHDRAWAL_NOT_AVAILABLE', meta: { reason: 'WRONG_STATE' } }, 'withdrawWrongState'],
    [{ code: 'SOMETHING_ELSE' }, 'failed'],
    [null, 'failed'],
  ] as const)('words %j as %s', (problem, key) => {
    expect(refusalOf(problem)).toBe(key);
  });

  it('names a sentence every catalogue has', () => {
    const keys: ControlsRefusal[] = [
      'extendAlready',
      'extendOutsideWindow',
      'extendBelow',
      'extendWrongState',
      'extendDate',
      'belowThreshold',
      'withdrawWrongState',
      'failed',
    ];
    for (const catalogue of [az, en, ru, tr]) {
      for (const key of keys) expect(catalogue.dashboardControls[key]).toBeTruthy();
    }
  });
});

describe('percentOf', () => {
  it('reads the wire number through its digits, and nothing for no goal', () => {
    expect(percentOf(87.5)?.toString()).toBe('87.5');
    expect(percentOf(null)).toBeNull();
    expect(percentOf(undefined)).toBeNull();
    expect(percentOf('not a number')).toBeNull();
  });
});
