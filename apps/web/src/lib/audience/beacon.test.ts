import { describe, expect, it, vi } from 'vitest';
import { AUDIENCE_ENDPOINT, audienceBody, sendAudienceEvent, type AudienceEvent } from './beacon';

/**
 * #634's beacon. What fails silently here is a count that is never sent, a body the service
 * answers 400, or a beacon that throws into the page — these pin all three.
 */

const PROJECT = '0193a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';

async function sentBody(sendBeacon: ReturnType<typeof vi.fn>): Promise<unknown> {
  const blob = sendBeacon.mock.calls[0]?.[1] as Blob;
  return JSON.parse(await blob.text());
}

describe('the body', () => {
  /*
   * The service answers a `surface` on a VISIT or a VIEW, and a `projectId` on a VISIT, with
   * 400. The union makes those unwritable; this pins that the serialiser does not add them.
   */
  it('sends only the fields each kind allows', () => {
    expect(audienceBody({ kind: 'VISIT' })).toEqual({ kind: 'VISIT', platform: 'WEB' });
    expect(audienceBody({ kind: 'VIEW', projectId: PROJECT })).toEqual({
      kind: 'VIEW',
      platform: 'WEB',
      projectId: PROJECT,
    });
    expect(audienceBody({ kind: 'CLICK', projectId: PROJECT, surface: 'SEARCH' })).toEqual({
      kind: 'CLICK',
      platform: 'WEB',
      projectId: PROJECT,
      surface: 'SEARCH',
    });
  });
});

describe('delivery', () => {
  it('hands a JSON blob to sendBeacon, at the same-origin endpoint', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchImpl = vi.fn();

    expect(sendAudienceEvent({ kind: 'VIEW', projectId: PROJECT }, { sendBeacon, fetch: fetchImpl })).toBe(
      'sendBeacon',
    );
    expect(sendBeacon).toHaveBeenCalledWith(AUDIENCE_ENDPOINT, expect.any(Blob));
    expect(AUDIENCE_ENDPOINT).toBe('/v1/audience/events');
    // A bare string would be `text/plain`, which the endpoint refuses.
    expect((sendBeacon.mock.calls[0]?.[1] as Blob).type).toBe('application/json');
    await expect(sentBody(sendBeacon)).resolves.toEqual({ kind: 'VIEW', platform: 'WEB', projectId: PROJECT });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to a keepalive fetch when sendBeacon refuses', () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    expect(
      sendAudienceEvent({ kind: 'CLICK', projectId: PROJECT, surface: 'HOME' }, { sendBeacon, fetch: fetchImpl }),
    ).toBe('fetch');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AUDIENCE_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin' });
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'CLICK',
      platform: 'WEB',
      projectId: PROJECT,
      surface: 'HOME',
    });
  });

  it('falls back to fetch when sendBeacon is absent or throws', () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const throwing = vi.fn(() => {
      throw new Error('blocked by an extension');
    });

    expect(sendAudienceEvent({ kind: 'VISIT' }, { fetch: fetchImpl })).toBe('fetch');
    expect(sendAudienceEvent({ kind: 'VISIT' }, { sendBeacon: throwing, fetch: fetchImpl })).toBe('fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /*
   * A counter is not allowed to become the incident: a rejected request, a fetch that throws
   * synchronously, and a browser with neither door all end quietly.
   */
  it('never throws, whatever the browser does', async () => {
    const rejecting = vi.fn().mockRejectedValue(new TypeError('offline'));
    const throwing = vi.fn(() => {
      throw new TypeError('keepalive quota');
    });
    const event: AudienceEvent = { kind: 'VISIT' };

    expect(sendAudienceEvent(event, { fetch: rejecting })).toBe('fetch');
    expect(sendAudienceEvent(event, { fetch: throwing })).toBe('none');
    expect(sendAudienceEvent(event, {})).toBe('none');
    // The rejection is swallowed rather than surfacing as an unhandled one.
    await Promise.resolve();
  });

  it('sends nothing from a browser driven by automation', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchImpl = vi.fn();

    expect(sendAudienceEvent({ kind: 'VISIT' }, { webdriver: true, sendBeacon, fetch: fetchImpl })).toBe('skipped');
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads the real browser when nothing is handed in', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    try {
      expect(sendAudienceEvent({ kind: 'VISIT' })).toBe('sendBeacon');
      Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
      expect(sendAudienceEvent({ kind: 'VISIT' })).toBe('skipped');
      expect(sendBeacon).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, 'sendBeacon');
      Reflect.deleteProperty(navigator, 'webdriver');
    }
  });
});
