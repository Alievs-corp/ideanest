import { describe, expect, it } from 'vitest';
import type { InboxNotification, NotificationType } from './api';
import { inboxCopyFrom } from '../i18n/notifications-copy';
import { translatorFor } from '../../test-copy';
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const COPY = inboxCopyFrom(translatorFor('account.notifications'));
import {
  CATEGORIES,
  CHANNELS,
  campaignOf,
  categoryDescription,
  categoryLabel,
  channelLabel,
  dayKeyOf,
  dayLabelOf,
  describeNotification,
  mandatoryReason,
  modeLabel,
  modesFor,
  readParams,
} from './describe';

/** Every type the contract publishes, so the sweep below cannot silently shrink. */
const TYPES: readonly NotificationType[] = [
  'PLEDGE_CONFIRMED',
  'PLEDGE_EDITED',
  'GOAL_REACHED',
  'DEADLINE_48H',
  'DEADLINE_24H',
  'CAMPAIGN_SUCCEEDED',
  'CAMPAIGN_UNSUCCESSFUL',
  'CAMPAIGN_EXTENDED',
  'WITHDRAWAL_REQUESTED',
  'PAYOUT_DETAILS_NEEDED',
  'PROJECT_APPROVED',
  'PAYMENT_COLLECTED',
  'PAYMENT_FAILED',
  'FINAL_PAYMENT_WARNING',
  'PAYOUT_SENT',
  'NEW_UPDATE_PUBLISHED',
  'COMMENT_REPLY',
  'DIRECT_MESSAGE',
  'SURVEY_AVAILABLE',
  'SURVEY_OVERDUE',
  'REWARD_SHIPPED',
  'FOLLOWED_CREATOR_LAUNCHED',
  'LAUNCH_REMINDER',
  'SAVED_PROJECT_ENDING_SOON',
  'NEW_DEVICE_SIGN_IN',
];

/** A document carrying everything any type reads — the shape #249 made routine. */
const FULL_PARAMS = {
  projectId: '01890000-0000-7000-8000-000000000001',
  projectTitle: 'Xari Bulbul Ceramics',
  creatorSlug: 'aysel-studio',
  projectSlug: 'xari-bulbul-ceramics',
  total: { amount: '120.00', currency: 'AZN' },
  amount: { amount: '120.00', currency: 'AZN' },
  goal: { amount: '5000.00', currency: 'AZN' },
  pledged: { amount: '6250.00', currency: 'AZN' },
  backersCount: 184,
  attempt: 2,
};

function notification(
  overrides: Partial<InboxNotification> & Pick<InboxNotification, 'type'>,
): InboxNotification {
  return {
    id: 'n1',
    category: 'CAMPAIGN',
    params: FULL_PARAMS,
    occurredAt: '2026-08-19T09:00:00.000Z',
    ...overrides,
  };
}

describe('readParams', () => {
  it('answers an empty document rather than throwing on anything that is not one', () => {
    expect(readParams(undefined)).toEqual({});
    expect(readParams(null)).toEqual({});
    // A row from a build that still sent the document as a JSON string is read as absent
    // rather than crashing the row it arrived on.
    expect(readParams('not an object')).toEqual({});
    // An array would index by number and read nothing, so it is refused as a document.
    expect(readParams([1, 2])).toEqual({});
  });

  it('reads an object', () => {
    expect(readParams({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('campaignOf', () => {
  it('reads the title and builds the two-segment public path', () => {
    expect(campaignOf(readParams(FULL_PARAMS))).toEqual({
      title: 'Xari Bulbul Ceramics',
      href: '/projects/aysel-studio/xari-bulbul-ceramics',
    });
  });

  /*
   * §10.2's campaign page takes two slugs. Half a pair addresses a different page or no
   * page, so it is no link rather than a shorter one — the same rule the service applies
   * when it builds the button in an email.
   */
  it('builds no link from half a pair', () => {
    expect(campaignOf({ creatorSlug: 'aysel-studio' }).href).toBeNull();
    expect(campaignOf({ projectSlug: 'xari-bulbul-ceramics' }).href).toBeNull();
  });

  it('answers nulls for a row written before the title existed', () => {
    expect(campaignOf({ projectId: 'x' })).toEqual({ title: null, href: null });
  });

  it('escapes a slug rather than concatenating it into a path', () => {
    expect(campaignOf({ creatorSlug: 'a b', projectSlug: 'c/d' }).href).toBe(
      '/projects/a%20b/c%2Fd',
    );
  });
});

describe('describeNotification', () => {
  it('names the campaign when the document carries a title', () => {
    const view = describeNotification(notification({ type: 'GOAL_REACHED' }), COPY);

    expect(view.campaign).toBe('Xari Bulbul Ceramics');
    expect(view.headline).toBe('Xari Bulbul Ceramics reached its goal of 5,000.00 AZN');
    expect(view.href).toBe('/projects/aysel-studio/xari-bulbul-ceramics');
  });

  /*
   * The rows written before #249 have no title, and neither has one whose campaign was
   * deleted. Every sentence has to survive that — a headline with a gap in it is the
   * failure this function exists to prevent.
   */
  it('still forms a sentence when the document names no campaign', () => {
    const view = describeNotification(
      notification({ type: 'GOAL_REACHED', params: { goal: { amount: '5000.00', currency: 'AZN' } } }),
      COPY,
    );

    expect(view.campaign).toBeNull();
    expect(view.headline).toBe('A campaign reached its goal of 5,000.00 AZN');
    expect(view.href).toBeNull();
  });

  it.each(TYPES)('renders %s as a finished sentence with a full document', (type) => {
    const view = describeNotification(notification({ type }), COPY);

    expect(view.headline).not.toBe('');
    expect(view.headline).not.toContain('  ');
    expect(view.headline).not.toContain('undefined');
    expect(view.headline).not.toContain('null');
  });

  it.each(TYPES)('renders %s as a finished sentence with an empty document', (type) => {
    const view = describeNotification(notification({ type, params: {} }), COPY);

    expect(view.headline).not.toBe('');
    expect(view.headline).not.toContain('  ');
    expect(view.headline).not.toContain('undefined');
    expect(view.headline).not.toContain('null');
  });

  /*
   * §10.3 puts an amount in the document as a string. A document that disagrees is one
   * this declines to read: `formatMoney` splits on a full stop, so a number would render
   * something plausible and wrong, and the fallback phrase is the honest answer.
   */
  it('refuses an amount that did not arrive as a string, rather than rendering it', () => {
    const view = describeNotification(
      notification({ type: 'PLEDGE_CONFIRMED', params: { total: { amount: 120, currency: 'AZN' } } }),
      COPY,
    );

    expect(view.headline).toBe('Your pledge of your chosen amount to a campaign is confirmed');
  });

  it('groups thousands and keeps the scale the service sent', () => {
    const view = describeNotification(notification({ type: 'CAMPAIGN_SUCCEEDED' }), COPY);

    expect(view.headline).toContain('6,250.00 AZN');
  });

  /*
   * The sign-in alert is the one message that is not about a campaign, and what somebody
   * who did not recognise it needs is the device list — not a campaign page, even when the
   * document happens to carry one.
   */
  it('sends the sign-in alert to the device list', () => {
    const view = describeNotification(
      notification({ type: 'NEW_DEVICE_SIGN_IN', category: 'SECURITY' }),
      COPY,
    );

    expect(view.href).toBe('/settings/sessions');
  });

  it('survives a document that is not an object at all', () => {
    // A row from a build that still sent the document as a JSON string, or any other shape
    // that is not a plain object — `readParams` refuses it rather than the row crashing.
    const view = describeNotification(
      notification({ type: 'PLEDGE_CONFIRMED', params: 'oops' as unknown as Record<string, unknown> }),
      COPY,
    );

    expect(view.headline).toBe('Your pledge of your chosen amount to a campaign is confirmed');
    expect(view.href).toBeNull();
  });
});

describe('labels', () => {
  it('has a label and a description for every category', () => {
    for (const category of CATEGORIES) {
      expect(categoryLabel(category, COPY)).not.toBe('');
      expect(categoryDescription(category, COPY)).not.toBe('');
      expect(mandatoryReason(category, COPY)).toContain('Always on');
    }
  });

  it('has a label for every channel and mode', () => {
    for (const channel of CHANNELS) expect(channelLabel(channel, COPY)).not.toBe('');
    expect(modeLabel('OFF', COPY)).toBe('Off');
    expect(modeLabel('IMMEDIATE', COPY)).toBe('As it happens');
    expect(modeLabel('DIGEST', COPY)).toBe('Daily digest');
  });

  it('gives the security reason only where it is true', () => {
    expect(mandatoryReason('SECURITY', COPY)).toContain('somebody else reaches your account');
    expect(mandatoryReason('PAYMENTS', COPY)).not.toContain('somebody else reaches your account');
  });

  /*
   * `digestOffered` is the service's answer to "can this channel batch". A client that
   * decided it independently would drift from §4.10 the first time the table changed, and
   * the drift would show as an option the service then refuses with a 422.
   */
  it('offers a digest only where the service says one is offered', () => {
    expect(modesFor(true)).toEqual(['IMMEDIATE', 'DIGEST', 'OFF']);
    expect(modesFor(false)).toEqual(['IMMEDIATE', 'OFF']);
  });
});

describe('grouping by day', () => {
  const NOW = new Date('2026-08-20T12:00:00.000Z');

  /*
   * Built from local components rather than from a UTC literal, because the grouping is
   * deliberately local: a UTC pair that looks like one day is two days for a reader east
   * of Greenwich, which is where this platform's readers are.
   */
  it('puts two instants on the same local day under one key', () => {
    const justAfterMidnight = new Date(2026, 7, 19, 0, 30).toISOString();
    const lateEvening = new Date(2026, 7, 19, 23, 30).toISOString();

    expect(dayKeyOf(justAfterMidnight)).toBe(dayKeyOf(lateEvening));
  });

  it('puts two local days under different keys', () => {
    const monday = new Date(2026, 7, 19, 12, 0).toISOString();
    const tuesday = new Date(2026, 7, 20, 12, 0).toISOString();

    expect(dayKeyOf(monday)).not.toBe(dayKeyOf(tuesday));
  });

  it('reads today and yesterday by name', () => {
    expect(dayLabelOf(NOW.toISOString(), NOW, 'en')).toBe('Today');
    expect(dayLabelOf('2026-08-19T09:00:00.000Z', NOW, 'en')).toBe('Yesterday');
  });

  it('reads anything older as a date', () => {
    expect(dayLabelOf('2026-08-01T09:00:00.000Z', NOW, 'en')).toContain('2026');
  });

  it('does not throw on an instant it cannot read', () => {
    expect(dayKeyOf('not a date')).toBe('unknown');
    expect(dayLabelOf('not a date', NOW, 'en')).toBe('Undated');
  });

  /**
   * #324. The heading is a heading, so it is capitalised — in the reader's own language,
   * because `toUpperCase` turns Turkish `içinde` into `Içinde`, which is a different word.
   */
  it('names the day in the reader’s language, capitalised the way that language does it', () => {
    expect(dayLabelOf(NOW.toISOString(), NOW, 'az')).toBe('Bu gün');
    expect(dayLabelOf(NOW.toISOString(), NOW, 'ru')).toBe('Сегодня');
    expect(dayLabelOf(NOW.toISOString(), NOW, 'tr')).toBe('Bugün');
    expect(dayLabelOf('2026-08-19T09:00:00.000Z', NOW, 'ru')).toBe('Вчера');
  });
});
