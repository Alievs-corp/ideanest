import { describe, expect, it } from 'vitest';
import { isPledgeId, issuedTotal, refundAmountFrom, type Refund } from './refunds';

function part(amount: string, id = amount): Refund {
  return {
    id,
    pledgeId: '11111111-2222-3333-4444-555555555555',
    projectId: 'p',
    amount: { amount, currency: 'AZN' },
    fullRefund: true,
    reason: 'BACKER_REQUEST',
    detail: 'd',
    state: 'SUCCEEDED',
    requestedAt: '2026-10-16T09:00:00Z',
  };
}

describe('a refund amount as typed', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['25', '25.00'],
    ['25,5', '25.50'],
    ['25.00', '25.00'],
    [' 1234,56 ', '1234.56'],
  ])('reads %j as %j', (typed, sent) => {
    expect(refundAmountFrom(typed)).toBe(sent);
  });

  it.each(['25.555', '0', '0,00', '-5', '25,00 AZN', '1e3', '25.', 'abc'])('refuses %j', (typed) => {
    expect(refundAmountFrom(typed)).toBeUndefined();
  });
});

describe('a pledge identifier', () => {
  it('is a whole UUID', () => {
    expect(isPledgeId('d4c3b2a1-0f9e-4d8c-b7a6-112233445501')).toBe(true);
    expect(isPledgeId(' d4c3b2a1-0f9e-4d8c-b7a6-112233445501 ')).toBe(true);
    expect(isPledgeId('d4c3b2a1')).toBe(false);
    expect(isPledgeId('d4c3b2a1-0f9e-4d8c-b7a6-11223344550')).toBe(false);
  });
});

describe('what an issued refund came to', () => {
  it('is its own amount when it went in one part', () => {
    expect(issuedTotal(part('25.00'))).toEqual({ amount: '25.00', currency: 'AZN' });
  });

  it('adds every part with decimals, never floats', () => {
    const issued = { ...part('0.10', 'a'), parts: [part('0.10', 'a'), part('0.20', 'b')] };
    expect(issuedTotal(issued)).toEqual({ amount: '0.30', currency: 'AZN' });
  });
});
