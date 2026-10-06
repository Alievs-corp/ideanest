import type * as Notifications from 'expo-notifications';
import { claimResponse, forgetHandledResponses, pushTapOf } from './push-taps';

const HOST = 'ideanest.az';
const PLEDGE = '01890000-0000-7000-8000-0000000000ab';

describe('where a tapped push goes (#160)', () => {
  it('opens a campaign, the device list, a pledge and the inbox from our scheme', () => {
    expect(pushTapOf({ url: 'ideanest://projects/a/b' }, HOST).destination).toEqual({
      pathname: '/projects/a/b',
    });
    expect(pushTapOf({ url: 'ideanest://settings/sessions' }, HOST).destination).toEqual({
      pathname: '/settings/sessions',
    });
    expect(pushTapOf({ url: `ideanest://pledges/${PLEDGE}` }, HOST).destination).toEqual({
      pathname: `/pledges/${PLEDGE}`,
    });
    expect(pushTapOf({ url: 'ideanest://notifications' }, HOST).destination).toEqual({
      pathname: '/notifications',
    });
  });

  it('opens the inbox for a push of ours with no destination — a digest', () => {
    expect(pushTapOf({ url: 'ideanest://' }, HOST).destination).toEqual({ pathname: '/notifications' });
    expect(pushTapOf({ url: 'ideanest://somewhere/new' }, HOST).destination).toEqual({
      pathname: '/notifications',
    });
  });

  it('ignores a foreign host and a url that is not a string', () => {
    expect(pushTapOf({ url: 'https://evil.example/projects/a/b' }, HOST).destination).toBeNull();
    expect(pushTapOf({ url: 'http://ideanest.az/projects/a/b' }, HOST).destination).toBeNull();
    expect(pushTapOf({ url: 42 }, HOST).destination).toBeNull();
    expect(pushTapOf({}, HOST).destination).toBeNull();
    expect(pushTapOf(null, HOST).destination).toBeNull();
  });

  it('reads the inbox row to mark read when the payload names one', () => {
    expect(pushTapOf({ url: 'ideanest://', notificationId: 'n-1', type: 'GOAL_REACHED' }, HOST)).toEqual({
      destination: { pathname: '/notifications' },
      notificationId: 'n-1',
    });
    expect(pushTapOf({ url: 'ideanest://', notificationId: 7 }, HOST).notificationId).toBeNull();
    expect(pushTapOf({ url: 'ideanest://', notificationId: ' ' }, HOST).notificationId).toBeNull();
  });
});

describe('claimResponse', () => {
  beforeEach(() => forgetHandledResponses());

  function response(identifier: string): Notifications.NotificationResponse {
    return {
      notification: { date: 1, request: { identifier, content: { data: {} } } },
    } as unknown as Notifications.NotificationResponse;
  }

  it('lets each response through once', () => {
    expect(claimResponse(response('r-1'))).toBe(true);
    expect(claimResponse(response('r-1'))).toBe(false);
    expect(claimResponse(response('r-2'))).toBe(true);
  });
});
