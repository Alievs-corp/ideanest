import { describe, expect, it } from 'vitest';
import { appPaymentReturn } from './app-return';

const at = (path: string) => appPaymentReturn(new URL(`https://ideyanest.com${path}`));

describe('appPaymentReturn', () => {
  it('forwards the app return to the app scheme, keeping only the hint', () => {
    expect(at('/az/pledges/6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b?payment=returned&via=app')).toBe(
      'ideanest://pledges/6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b?payment=returned',
    );
    expect(at('/pledges/abc?via=app&payment=failed&extra=1')).toBe('ideanest://pledges/abc?payment=failed');
  });

  it('leaves everything else to the site', () => {
    expect(at('/az/pledges/abc?payment=returned')).toBeNull();
    expect(at('/az/pledges/abc?payment=paid&via=app')).toBeNull();
    expect(at('/az/pledges/abc/address?payment=returned&via=app')).toBeNull();
    expect(at('/az/pledges/a%2Fb?payment=returned&via=app')).toBeNull();
    expect(at('/az/projects/abc?payment=returned&via=app')).toBeNull();
  });
});
