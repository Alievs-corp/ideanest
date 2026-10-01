import { describe, expect, it } from 'vitest';
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RECONNECT_ATTEMPTS,
  addToTotal,
  commentsChannel,
  counterChannel,
  parseUpdate,
  realtimeUrl,
  reconnectDelayMs,
} from './realtime';

/**
 * §12.1's messages, and the arithmetic a page does with them.
 *
 * The two things worth holding here:
 *
 * - **The parse trusts nothing.** It runs on whatever arrived over a socket, and a lenient
 *   parse shows `NaN` to every reader of a campaign page rather than to whoever sent the bad
 *   frame.
 * - **The total is `Decimal`.** This is the one place on the platform where an amount is
 *   accumulated repeatedly in a browser, so a float would drift and the page would slowly
 *   disagree with the campaign.
 */

describe('realtimeUrl', () => {
  it('is null when no origin is configured, which is the default', () => {
    expect(realtimeUrl(undefined, counterChannel('p'))).toBeNull();
    expect(realtimeUrl('', counterChannel('p'))).toBeNull();
    expect(realtimeUrl('   ', counterChannel('p'))).toBeNull();
  });

  it('accepts an http origin and connects over ws', () => {
    expect(realtimeUrl('http://localhost:8080', counterChannel('abc'))).toBe(
      'ws://localhost:8080/v1/realtime?channel=project%3Aabc',
    );
  });

  it('accepts an https origin and connects over wss', () => {
    expect(realtimeUrl('https://api.ideanest.az', commentsChannel('abc'))).toBe(
      'wss://api.ideanest.az/v1/realtime?channel=project%3Aabc%3Acomments',
    );
  });

  it('accepts a plain ws origin as it is', () => {
    expect(realtimeUrl('ws://10.0.2.2:8080', counterChannel('abc'))).toBe(
      'ws://10.0.2.2:8080/v1/realtime?channel=project%3Aabc',
    );
  });

  it('trims a trailing slash from an http origin too', () => {
    expect(realtimeUrl('https://api.ideanest.az//', counterChannel('abc'))).toBe(
      'wss://api.ideanest.az/v1/realtime?channel=project%3Aabc',
    );
  });

  it('accepts a ws origin as it is, and tolerates a trailing slash', () => {
    expect(realtimeUrl('wss://api.ideanest.az/', counterChannel('abc'))).toBe(
      'wss://api.ideanest.az/v1/realtime?channel=project%3Aabc',
    );
  });

  /*
   * A scheme the browser cannot open is refused rather than passed to `new WebSocket`, which
   * would throw inside an effect and take the page down over a configuration mistake.
   */
  it('refuses an origin whose scheme is not a socket', () => {
    expect(realtimeUrl('ftp://api.ideanest.az', counterChannel('abc'))).toBeNull();
    expect(realtimeUrl('api.ideanest.az', counterChannel('abc'))).toBeNull();
  });
});

describe('parseUpdate', () => {
  it('reads a counter window', () => {
    const update = parseUpdate(
      JSON.stringify({ channel: 'project:abc', pledges: 2, amount: { amount: '40.50', currency: 'AZN' } }),
    );

    expect(update).toEqual({
      channel: 'project:abc',
      pledges: 2,
      amount: { amount: '40.50', currency: 'AZN' },
      comments: 0,
      latestCommentId: null,
    });
  });

  it('reads a comments window', () => {
    const update = parseUpdate(
      JSON.stringify({ channel: 'project:abc:comments', comments: 3, latestCommentId: 'c-9' }),
    );

    expect(update?.comments).toBe(3);
    expect(update?.latestCommentId).toBe('c-9');
    expect(update?.pledges).toBe(0);
    expect(update?.amount).toBeNull();
  });

  it('is null for anything that is not a message from this server', () => {
    expect(parseUpdate('not json')).toBeNull();
    expect(parseUpdate('null')).toBeNull();
    expect(parseUpdate('[]')).toBeNull();
    expect(parseUpdate('"a string"')).toBeNull();
    expect(parseUpdate(JSON.stringify({ pledges: 1 }))).toBeNull();
    expect(parseUpdate(JSON.stringify({ channel: '' }))).toBeNull();
  });

  /*
   * §10.3: money crosses as a string, never a JSON number. A number here means either a server
   * that broke the rule or a frame that did not come from one, and accepting it would be
   * accepting a value that has already lost precision.
   */
  it('refuses an amount sent as a JSON number', () => {
    const update = parseUpdate(
      JSON.stringify({ channel: 'project:abc', pledges: 1, amount: { amount: 40.5, currency: 'AZN' } }),
    );

    expect(update?.amount).toBeNull();
    expect(update?.pledges).toBe(1);
  });

  it('refuses an amount that is not a decimal', () => {
    for (const amount of ['1e5', '0x10', '12abc', 'Infinity', '']) {
      const update = parseUpdate(
        JSON.stringify({ channel: 'project:abc', pledges: 1, amount: { amount, currency: 'AZN' } }),
      );
      expect(update?.amount, amount).toBeNull();
    }
  });

  it('treats a nonsensical count as no count', () => {
    for (const pledges of [-1, 1.5, '2', null]) {
      const update = parseUpdate(JSON.stringify({ channel: 'project:abc', pledges }));
      expect(update?.pledges, String(pledges)).toBe(0);
    }
  });
});

describe('addToTotal', () => {
  it('adds without floating point', () => {
    const total = { amount: '0.10', currency: 'AZN' };

    /*
     * 0.1 + 0.2 !== 0.3 in IEEE 754, which is exactly why CLAUDE.md forbids a float here. The
     * assertion is on the string, so a passing test cannot be a rounded display of a wrong
     * number.
     */
    expect(addToTotal(total, { amount: '0.20', currency: 'AZN' })).toEqual({
      amount: '0.30',
      currency: 'AZN',
    });
  });

  it('keeps the scale of the total it started from', () => {
    expect(addToTotal({ amount: '5000.00', currency: 'AZN' }, { amount: '25', currency: 'AZN' })).toEqual({
      amount: '5025.00',
      currency: 'AZN',
    });
  });

  it('does not drift over many windows', () => {
    let total = { amount: '0.00', currency: 'AZN' };
    for (let window = 0; window < 1_000; window += 1) {
      total = addToTotal(total, { amount: '0.01', currency: 'AZN' });
    }

    expect(total.amount).toBe('10.00');
  });

  it('ignores a window with nothing in it', () => {
    const total = { amount: '5000.00', currency: 'AZN' };
    expect(addToTotal(total, null)).toBe(total);
  });

  /*
   * A campaign has one currency, so a mismatch is a fact that has stopped being true. Adding
   * the number anyway would show a total in the wrong unit, and there is nothing here that
   * could convert it.
   */
  it('ignores a window in another currency rather than adding it', () => {
    const total = { amount: '5000.00', currency: 'AZN' };
    expect(addToTotal(total, { amount: '25.00', currency: 'USD' })).toBe(total);
  });
});

/**
 * #155: one reconnect policy for the browser's hook and the app's. Each close asks
 * `reconnectDelayMs(attempts)`; a socket that opens resets `attempts` to zero.
 */
describe('reconnecting', () => {
  it('waits a second, then doubles: 1s, 2s, 4s, 8s, 16s, 32s', () => {
    const waits = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, attempts) => reconnectDelayMs(attempts));
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(BASE_BACKOFF_MS).toBe(1_000);
  });

  it('gives up after six consecutive attempts', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(6);
    expect(reconnectDelayMs(6)).toBeNull();
    expect(reconnectDelayMs(50)).toBeNull();
  });

  it('never waits longer than a minute, whatever the attempt', () => {
    expect(MAX_BACKOFF_MS).toBe(60_000);
    for (let attempts = 0; attempts < MAX_RECONNECT_ATTEMPTS; attempts += 1) {
      expect(reconnectDelayMs(attempts)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    }
  });

  /**
   * The sequence a socket that fails three times, opens, and fails again sees: the open resets
   * the count, so the fourth failure waits a second rather than eight.
   */
  it('starts again from a second after a socket opens', () => {
    let attempts = 0;
    const waits: (number | null)[] = [];
    const close = () => {
      const wait = reconnectDelayMs(attempts);
      waits.push(wait);
      if (wait !== null) attempts += 1;
    };
    close();
    close();
    close();
    attempts = 0; // onopen
    close();

    expect(waits).toEqual([1_000, 2_000, 4_000, 1_000]);
  });
});
