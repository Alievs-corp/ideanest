import { describe, expect, it } from 'vitest';
import {
  chargeNoteOf,
  isDisputable,
  isEditable,
  isRaisable,
  isSettling,
  paymentReturnOutcome,
  pledgeTone,
  quotedRate,
  raiseInFlight,
  raiseReturnOutcome,
  readReturnHint,
} from './pledge';
import type { PledgeRaise } from './types';

const STATES = [
  'DRAFT',
  'CONFIRMED',
  'EXPIRED',
  'CANCELED_BY_BACKER',
  'CANCELED_BY_PROJECT',
  'CHARGE_PENDING',
  'CHARGE_FAILED',
  'COLLECTED',
  'DROPPED',
  'REFUNDED',
  'CHARGEBACK',
  'FULFILLED',
] as const;

const NOW = Date.parse('2026-10-02T12:00:00Z');

function raise(state: string, holdExpiresAt = '2026-10-02T12:10:00Z'): PledgeRaise {
  return {
    id: 'r1',
    state,
    amount: { amount: '5.00', currency: 'AZN' },
    total: { amount: '55.00', currency: 'AZN' },
    holdExpiresAt,
    createdAt: '2026-10-02T11:55:00Z',
  };
}

describe('which controls a pledge offers', () => {
  it('is editable only while DRAFT or CONFIRMED', () => {
    for (const state of STATES) {
      expect(isEditable(state)).toBe(state === 'DRAFT' || state === 'CONFIRMED');
    }
  });

  it('is disputable only when COLLECTED', () => {
    for (const state of STATES) expect(isDisputable(state)).toBe(state === 'COLLECTED');
  });

  it('is raisable only when COLLECTED and the service says so', () => {
    expect(isRaisable({ state: 'COLLECTED', raisable: true })).toBe(true);
    expect(isRaisable({ state: 'COLLECTED' })).toBe(false);
    expect(isRaisable({ state: 'CONFIRMED', raisable: true })).toBe(false);
  });
});

describe('pledgeTone and chargeNoteOf', () => {
  it('maps the web tones', () => {
    expect(pledgeTone('DRAFT')).toBe('warning');
    expect(pledgeTone('CHARGE_PENDING')).toBe('warning');
    expect(pledgeTone('CHARGE_FAILED')).toBe('danger');
    expect(pledgeTone('COLLECTED')).toBe('success');
    expect(pledgeTone('FULFILLED')).toBe('success');
    expect(pledgeTone('REFUNDED')).toBe('default');
    expect(pledgeTone('SOMETHING_NEW')).toBe('default');
  });

  it('only says charged or not where certain', () => {
    expect(chargeNoteOf('COLLECTED')).toBe('charged');
    expect(chargeNoteOf('FULFILLED')).toBe('charged');
    expect(chargeNoteOf('DRAFT')).toBe('notCharged');
    expect(chargeNoteOf('EXPIRED')).toBe('notCharged');
    expect(chargeNoteOf('CANCELED_BY_BACKER')).toBe('notCharged');
    expect(chargeNoteOf('REFUNDED')).toBeNull();
    expect(chargeNoteOf('CONFIRMED')).toBeNull();
  });
});

describe('readReturnHint', () => {
  it('accepts only returned and failed', () => {
    expect(readReturnHint('returned')).toBe('returned');
    expect(readReturnHint('failed')).toBe('failed');
    expect(readReturnHint('paid')).toBeNull();
    expect(readReturnHint(['returned'])).toBeNull();
    expect(readReturnHint(undefined)).toBeNull();
  });
});

describe('paymentReturnOutcome', () => {
  it('is paid for COLLECTED whatever the hint said', () => {
    expect(paymentReturnOutcome('returned', 'COLLECTED')).toBe('paid');
    expect(paymentReturnOutcome('failed', 'COLLECTED')).toBe('paid');
  });

  it('waits for a returned DRAFT', () => {
    expect(paymentReturnOutcome('returned', 'DRAFT')).toBe('waiting');
  });

  it('fails a failed DRAFT and any EXPIRED', () => {
    expect(paymentReturnOutcome('failed', 'DRAFT')).toBe('failed');
    expect(paymentReturnOutcome('returned', 'EXPIRED')).toBe('failed');
    expect(paymentReturnOutcome('failed', 'EXPIRED')).toBe('failed');
  });

  it('says nothing for other states', () => {
    expect(paymentReturnOutcome('returned', 'REFUNDED')).toBeNull();
  });
});

describe('raiseReturnOutcome', () => {
  it('reads the raise rather than the pledge', () => {
    expect(raiseReturnOutcome('failed', raise('SUCCEEDED'), NOW)).toBe('raised');
    expect(raiseReturnOutcome('returned', raise('UNAPPLIED'), NOW)).toBe('unapplied');
    expect(raiseReturnOutcome('returned', raise('PENDING'), NOW)).toBe('waiting');
    expect(raiseReturnOutcome('failed', raise('PENDING'), NOW)).toBe('held');
    expect(raiseReturnOutcome('failed', raise('PENDING', '2026-10-02T11:00:00Z'), NOW)).toBe('failed');
    for (const state of ['FAILED', 'EXPIRED', 'ABANDONED']) {
      expect(raiseReturnOutcome('returned', raise(state), NOW)).toBe('failed');
    }
    expect(raiseReturnOutcome('returned', raise('NEW_STATE'), NOW)).toBeNull();
    expect(raiseReturnOutcome('returned', null, NOW)).toBeNull();
  });
});

describe('isSettling and raiseInFlight', () => {
  it('settles a returned DRAFT and a pending raise', () => {
    expect(isSettling({ state: 'DRAFT' }, 'returned', null)).toBe(true);
    expect(isSettling({ state: 'DRAFT' }, 'failed', null)).toBe(false);
    expect(isSettling({ state: 'COLLECTED' }, 'returned', null)).toBe(false);
    expect(isSettling({ state: 'COLLECTED', latestRaise: raise('PENDING') }, null, 'failed')).toBe(true);
    expect(isSettling({ state: 'COLLECTED', latestRaise: raise('SUCCEEDED') }, null, 'returned')).toBe(false);
  });

  it('holds a pending raise until its hold ends', () => {
    expect(raiseInFlight({ latestRaise: raise('PENDING') }, NOW)).toBe(true);
    expect(raiseInFlight({ latestRaise: raise('PENDING', '2026-10-02T11:00:00Z') }, NOW)).toBe(false);
    expect(raiseInFlight({ latestRaise: raise('SUCCEEDED') }, NOW)).toBe(false);
  });
});

describe('quotedRate', () => {
  it('needs both halves', () => {
    expect(quotedRate({ displayCurrency: 'USD', displayRate: '1.7' })).toEqual({
      currency: 'USD',
      rate: '1.7',
      publishedFor: '',
    });
    expect(quotedRate({ displayCurrency: 'USD' })).toBeNull();
    expect(quotedRate({ displayRate: '1.7' })).toBeNull();
  });
});
