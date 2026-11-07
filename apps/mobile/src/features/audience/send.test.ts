import type * as Send from './send';

/**
 * What reaches the wire (#636): the contract's body for each kind, the platform from the OS, no
 * session, and never an exception or a wait. `jest.setup.ts` replaces the send for every other
 * suite; this one takes the real module.
 */
const { audienceBody, audiencePlatform, sendAudienceEvent } = jest.requireActual<typeof Send>('./send');

const ENDPOINT = 'https://api.test.invalid/v1/audience/events';
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

function sentBody(call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe('the body', () => {
  it('is the contract for each kind, with a surface on a CLICK only', () => {
    expect(audienceBody({ kind: 'VISIT' }, 'IOS')).toEqual({ kind: 'VISIT', platform: 'IOS' });
    expect(audienceBody({ kind: 'VIEW', projectId: 'p-1' }, 'ANDROID')).toEqual({
      kind: 'VIEW',
      platform: 'ANDROID',
      projectId: 'p-1',
    });
    expect(audienceBody({ kind: 'CLICK', projectId: 'p-1', surface: 'HOME' }, 'IOS')).toEqual({
      kind: 'CLICK',
      platform: 'IOS',
      projectId: 'p-1',
      surface: 'HOME',
    });
  });

  it('names the platform from the OS, and none for the web build', () => {
    expect(audiencePlatform('ios')).toBe('IOS');
    expect(audiencePlatform('android')).toBe('ANDROID');
    expect(audiencePlatform('web')).toBeNull();
  });
});

describe('sending', () => {
  it('POSTs JSON to the audience endpoint with no session on it', () => {
    sendAudienceEvent({ kind: 'CLICK', projectId: 'p-1', surface: 'DISCOVER' }, 'android');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(sentBody()).toEqual({ kind: 'CLICK', platform: 'ANDROID', projectId: 'p-1', surface: 'DISCOVER' });
  });

  it('sends a VISIT as IOS on an iPhone', () => {
    sendAudienceEvent({ kind: 'VISIT' }, 'ios');
    expect(sentBody()).toEqual({ kind: 'VISIT', platform: 'IOS' });
  });

  it('returns at once rather than waiting for the answer', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    expect(sendAudienceEvent({ kind: 'VISIT' }, 'ios')).toBeUndefined();
  });

  it('swallows a refused, a rate-limited and a failed request', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect(() => sendAudienceEvent({ kind: 'VISIT' }, 'ios')).not.toThrow();
    expect(() => sendAudienceEvent({ kind: 'VISIT' }, 'ios')).not.toThrow();
    // Let the rejection settle: an unhandled one would fail the suite.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('swallows a fetch that throws before it starts', () => {
    fetchMock.mockImplementation(() => {
      throw new Error('no fetch');
    });
    expect(() => sendAudienceEvent({ kind: 'VISIT' }, 'ios')).not.toThrow();
  });

  it('sends nothing from the web build or for a card with no id', () => {
    sendAudienceEvent({ kind: 'VISIT' }, 'web');
    sendAudienceEvent({ kind: 'VIEW', projectId: '' }, 'ios');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
