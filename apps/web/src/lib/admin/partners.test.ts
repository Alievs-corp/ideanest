import { describe, expect, it } from 'vitest';
import { formatShare, shareFromInput } from './partners';

describe('a share as somebody typed it', () => {
  it('takes the comma the hint writes, and gives the service its point', () => {
    // The hint says "0,01" in three languages, and "12,5" typed that way was refused.
    expect(shareFromInput('12,5')).toBe('12.5');
    expect(shareFromInput(' 33,33 ')).toBe('33.33');
    expect(shareFromInput('50')).toBe('50');
    expect(shareFromInput('0.01')).toBe('0.01');
  });

  it('keeps both ends of the range, which the service holds inclusive at the top', () => {
    expect(shareFromInput('100')).toBe('100');
    expect(shareFromInput('100,00')).toBe('100.00');
    expect(shareFromInput('100,01')).toBeNull();
    expect(shareFromInput('0')).toBeNull();
    expect(shareFromInput('0,00')).toBeNull();
  });

  it('refuses what is not a share rather than guessing at it', () => {
    expect(shareFromInput('12,345')).toBeNull();
    expect(shareFromInput('1.000,5')).toBeNull();
    expect(shareFromInput('-5')).toBeNull();
    expect(shareFromInput('5%')).toBeNull();
    expect(shareFromInput('')).toBeNull();
    expect(shareFromInput('1e2')).toBeNull();
  });
});

describe('a share for reading', () => {
  it("is written the reader's way, not as the wire's string", () => {
    expect(formatShare('12.50', 'az')).toBe('12,5%');
    expect(formatShare('12.50', 'en')).toBe('12.5%');
    expect(formatShare('50.00', 'az')).toBe('50%');
  });

  it('puts the sign in front where the language does', () => {
    expect(formatShare('12.50', 'tr')).toBe('%12,5');
  });
});
