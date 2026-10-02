import { describe, expect, it } from 'vitest';
import { appCardReturn } from './app-return';

const at = (path: string) => appCardReturn(new URL(`https://ideyanest.com${path}`));

describe('appCardReturn', () => {
  it('forwards the app return to the app scheme, keeping only the hint', () => {
    expect(at('/az/settings/payout?card=returned&via=app')).toBe('ideanest://settings/payout?card=returned');
    expect(at('/settings/payout?via=app&card=failed&extra=1')).toBe('ideanest://settings/payout?card=failed');
    expect(at('/tr/settings/payout/?card=returned&via=app')).toBe('ideanest://settings/payout?card=returned');
  });

  it('leaves everything else to the site', () => {
    expect(at('/az/settings/payout?card=returned')).toBeNull();
    expect(at('/az/settings/payout?card=verified&via=app')).toBeNull();
    expect(at('/az/settings/payout?via=app')).toBeNull();
    expect(at('/az/settings/email?card=returned&via=app')).toBeNull();
    expect(at('/de/settings/payout?card=returned&via=app')).toBeNull();
    expect(at('/az/pledges/abc?card=returned&via=app')).toBeNull();
  });
});
