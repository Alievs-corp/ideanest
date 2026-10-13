import { describe, expect, it } from 'vitest';
import { bankFeeFrom } from './bank-fee';

describe('bankFeeFrom (#401)', () => {
  it('reads blank and zero as no fee', () => {
    expect(bankFeeFrom('')).toBeNull();
    expect(bankFeeFrom('  ')).toBeNull();
    expect(bankFeeFrom('0')).toBeNull();
    expect(bankFeeFrom('0,00')).toBeNull();
  });

  it('sends a decimal string, reading a comma as the decimal mark', () => {
    expect(bankFeeFrom('1.20')).toBe('1.20');
    expect(bankFeeFrom(' 1,2 ')).toBe('1.2');
    expect(bankFeeFrom('15')).toBe('15');
  });

  it('refuses what the service would refuse', () => {
    expect(bankFeeFrom('1.234')).toBeUndefined();
    expect(bankFeeFrom('-1')).toBeUndefined();
    expect(bankFeeFrom('1 200')).toBeUndefined();
    expect(bankFeeFrom('abc')).toBeUndefined();
  });
});
