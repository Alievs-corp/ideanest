import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import { acceptsPledges } from '@ideanest/campaign/pledgeable';
import { successThresholdOf } from '@ideanest/campaign/threshold';
import { completionOf } from '@ideanest/campaign/completion';
import { countdownIntervalMs, countdownLabel, remainingUntil, type CountdownUnits } from '@ideanest/campaign/deadline';
import { daysLeftOf } from '@ideanest/campaign/days-left';
import { campaignTabFrom } from '@ideanest/campaign/tabs';
import { readStoryDocument } from '@ideanest/campaign/story';
import { isRenderableState } from '@ideanest/campaign/states';
import {
  addToTotal,
  counterChannel,
  parseUpdate,
  realtimeUrl,
  reconnectDelayMs,
} from '@ideanest/campaign/realtime';
import { reportBody } from '@ideanest/campaign/report';

/**
 * `@ideanest/campaign` under jest-expo — the app's half of "shared tests run in both apps" (#155).
 *
 * The package's own suite runs under vitest on Node. This repeats the decisions the campaign
 * screen will lean on through the app's resolver and Babel transform, so a module that only
 * resolves or only behaves under one of them fails here first — the way
 * `discovery-shared.test.ts` caught React Native's `URLSearchParams` (#153).
 */

const NOW = new Date('2026-08-19T12:00:00Z');

describe('which campaigns take pledges and have a page', () => {
  it('offers LIVE until its deadline, and the two IDN-EXT-01 states after it', () => {
    expect(acceptsPledges('LIVE', '2026-08-20T12:00:00Z', NOW)).toBe(true);
    expect(acceptsPledges('LIVE', '2026-08-19T11:59:59Z', NOW)).toBe(false);
    expect(acceptsPledges('LIVE', null, NOW)).toBe(true);
    expect(acceptsPledges('LIVE', 'not a date', NOW)).toBe(true);
    expect(acceptsPledges('CLOSING_WINDOW', '2026-08-01T00:00:00Z', NOW)).toBe(true);
    expect(acceptsPledges('EXTENDED', '2026-08-01T00:00:00Z', NOW)).toBe(true);
    expect(acceptsPledges('PRELAUNCH', '2026-09-01T00:00:00Z', NOW)).toBe(false);
    expect(acceptsPledges('LATE_PLEDGE', '2026-09-01T00:00:00Z', NOW)).toBe(false);
  });

  it('shows not-found for a draft and a page for a cancelled campaign', () => {
    expect(isRenderableState('DRAFT')).toBe(false);
    expect(isRenderableState('CANCELED')).toBe(true);
  });
});

describe('money on the page', () => {
  it('names the 80% threshold rounded up, with no float path', () => {
    expect(successThresholdOf({ amount: '1001.01', currency: 'AZN' }).amount).toBe('800.81');
    expect(successThresholdOf({ amount: '1.10', currency: 'AZN' }).amount).toBe('0.88');
  });

  it('computes the funded percent rounded down', () => {
    expect(completionOf({ amount: '9999.60', currency: 'AZN' }, { amount: '10000.00', currency: 'AZN' })?.toFixed(2)).toBe(
      '99.99',
    );
  });
});

describe('the live counter', () => {
  it('derives the socket address from the origin', () => {
    expect(realtimeUrl('https://api.ideyanest.com/', counterChannel('p1'))).toBe(
      'wss://api.ideyanest.com/v1/realtime?channel=project%3Ap1',
    );
    expect(realtimeUrl(undefined, counterChannel('p1'))).toBeNull();
  });

  it('adds a thousand windows of 0.01 to exactly 10.00 and ignores a foreign currency', () => {
    let total = { amount: '0.00', currency: 'AZN' };
    for (let window = 0; window < 1_000; window += 1) {
      const update = parseUpdate(JSON.stringify({ channel: 'project:p1', pledges: 1, amount: { amount: '0.01', currency: 'AZN' } }));
      total = addToTotal(total, update?.amount ?? null);
    }
    expect(total.amount).toBe('10.00');
    expect(addToTotal(total, { amount: '5.00', currency: 'USD' })).toBe(total);
  });

  it('refuses a float amount', () => {
    expect(parseUpdate(JSON.stringify({ channel: 'project:p1', amount: { amount: 0.5, currency: 'AZN' } }))?.amount).toBeNull();
  });

  it('backs off 1s to 32s and stops after six attempts', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, null]);
  });
});

describe('the countdown, through the app’s Intl', () => {
  const units = (catalogue: typeof en): CountdownUnits => ({
    ...catalogue.campaign.countdown.units,
    pair: catalogue.campaign.countdown.pair,
  });

  it('labels and ticks as the web does', () => {
    const remaining = remainingUntil('2026-08-21T14:30:45Z', NOW);
    if (remaining === null) throw new Error('fixture');
    expect(countdownLabel(remaining, units(en), 'en')).toBe('2 days, 2 hours');
    expect(countdownLabel(remaining, units(ru as typeof en), 'ru')).toBe('2 дня, 2 часа');
    expect(countdownIntervalMs(remaining)).toBe(60_000);
    expect(daysLeftOf('2026-08-21T14:30:45Z', NOW)).toBe(2);
  });
});

describe('links and documents', () => {
  it('opens the tab a link names, and the campaign tab for anything else', () => {
    expect(campaignTabFrom('comments')).toBe('comments');
    expect(campaignTabFrom(['faq', 'updates'])).toBe('faq');
    expect(campaignTabFrom('rewards')).toBe('campaign');
  });

  it('reads a version-1 story and refuses a TipTap tree', () => {
    expect(readStoryDocument({ version: 1, blocks: [{ type: 'rule' }] })?.blocks).toHaveLength(1);
    expect(readStoryDocument({ type: 'doc', content: [] })).toBeNull();
  });

  it('builds a report body without an empty detail', () => {
    expect(reportBody('SPAM', '  ')).toEqual({ reason: 'SPAM' });
  });
});
