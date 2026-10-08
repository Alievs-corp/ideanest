import { describe, expect, it } from 'vitest';
import { destinationFor } from './destination';

const HOST = 'ideanest.az';

describe('settings links (#161)', () => {
  it('opens the list from /settings, with or without a locale', () => {
    expect(destinationFor('https://ideanest.az/settings', HOST)).toEqual({ pathname: '/settings' });
    expect(destinationFor('https://ideanest.az/az/settings/', HOST)).toEqual({ pathname: '/settings' });
    expect(destinationFor('ideanest://settings', HOST)).toEqual({ pathname: '/settings' });
  });

  it.each(['profile', 'email', 'password', 'security', 'sessions', 'language', 'notifications', 'privacy'])(
    'opens /settings/%s',
    (section) => {
      expect(destinationFor(`https://ideanest.az/ru/settings/${section}`, HOST)).toEqual({
        pathname: `/settings/${section}`,
      });
    },
  );

  it('keeps the payout card return and drops anything else', () => {
    expect(destinationFor('ideanest://settings/payout?card=returned', HOST)).toEqual({
      pathname: '/settings/payout',
      params: { card: 'returned' },
    });
    expect(destinationFor('https://ideanest.az/en/settings/payout?card=failed&x=1', HOST)).toEqual({
      pathname: '/settings/payout',
      params: { card: 'failed' },
    });
    expect(destinationFor('https://ideanest.az/settings/payout?card=nonsense', HOST)).toEqual({
      pathname: '/settings/payout',
    });
  });

  it('refuses a section neither platform has, and anything deeper', () => {
    expect(destinationFor('https://ideanest.az/settings/billing', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/settings/profile/extra', HOST)).toBeNull();
  });
});
