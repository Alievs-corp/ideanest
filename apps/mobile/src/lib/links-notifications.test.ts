import { destinationFor } from './links';

const HOST = 'ideanest.az';
const PLEDGE = '01890000-0000-7000-8000-0000000000ab';

/** The paths a push relies on (#160), in the form `PushComposer` sends them and as web links. */
describe('notification links', () => {
  it('opens the inbox', () => {
    expect(destinationFor('ideanest://notifications', HOST)).toEqual({ pathname: '/notifications' });
    expect(destinationFor('https://ideanest.az/notifications', HOST)).toEqual({ pathname: '/notifications' });
    expect(destinationFor('https://ideanest.az/az/notifications/', HOST)).toEqual({ pathname: '/notifications' });
    expect(destinationFor('https://ideanest.az/notifications/extra', HOST)).toBeNull();
  });

  it('opens the device list, a pledge and a campaign from our scheme', () => {
    expect(destinationFor('ideanest://settings/sessions', HOST)).toEqual({ pathname: '/settings/sessions' });
    expect(destinationFor('ideanest://settings/notifications', HOST)).toEqual({
      pathname: '/settings/notifications',
    });
    expect(destinationFor(`ideanest://pledges/${PLEDGE}`, HOST)).toEqual({ pathname: `/pledges/${PLEDGE}` });
    expect(destinationFor('ideanest://projects/aysel-studio/lamp', HOST)).toEqual({
      pathname: '/projects/aysel-studio/lamp',
    });
  });

  it('refuses the same paths from a host this build does not claim', () => {
    expect(destinationFor('https://evil.example/notifications', HOST)).toBeNull();
    expect(destinationFor('https://evil.example/settings/sessions', HOST)).toBeNull();
  });
});
