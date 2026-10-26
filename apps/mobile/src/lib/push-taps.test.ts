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
      web: null,
      notificationId: 'n-1',
    });
    expect(pushTapOf({ url: 'ideanest://', notificationId: 7 }, HOST).notificationId).toBeNull();
    expect(pushTapOf({ url: 'ideanest://', notificationId: ' ' }, HOST).notificationId).toBeNull();
  });
});

describe('a campaign that did not open at its launch time (#589)', () => {
  it('opens the campaign’s editor at its review tab, which the service now names', () => {
    const id = '01890000-0000-7000-8000-000000000001';
    expect(
      pushTapOf({ url: `ideanest://projects/${id}/edit/review`, type: 'SCHEDULED_LAUNCH_REFUSED' }, HOST),
    ).toEqual({ destination: { pathname: `/campaigns/${id}/edit/review` }, web: null, notificationId: null });
  });
});

describe('a message about the creator’s plan (#452)', () => {
  it('opens the pricing page on the website for each of the three types, whatever the url says', () => {
    for (const type of ['SUBSCRIPTION_RENEWAL_DUE', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_RENEWED']) {
      expect(pushTapOf({ url: 'ideanest://pricing', type, notificationId: 'n-1' }, HOST)).toEqual({
        destination: null,
        web: '/pricing',
        notificationId: 'n-1',
      });
      // A push sent before the service gave these a path carried the bare scheme.
      expect(pushTapOf({ url: 'ideanest://', type }, HOST)).toEqual({
        destination: null,
        web: '/pricing',
        notificationId: null,
      });
    }
  });

  it('leaves every other type, and a pricing link without a plan type, to the parser', () => {
    expect(pushTapOf({ url: 'ideanest://pricing', type: 'GOAL_REACHED' }, HOST)).toEqual({
      destination: { pathname: '/pricing' },
      web: null,
      notificationId: null,
    });
    expect(pushTapOf({ url: 'ideanest://pricing' }, HOST).web).toBeNull();
    expect(pushTapOf({ url: 'ideanest://pricing', type: 42 }, HOST).web).toBeNull();
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
