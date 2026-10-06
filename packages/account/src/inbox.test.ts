import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { CATEGORIES, CHANNELS } from './notifications';
import {
  campaignOf,
  categoryDescription,
  categoryLabel,
  channelLabel,
  cursorOf,
  dayKeyOf,
  dayLabelOf,
  describeNotification,
  groupByDay,
  hrefOf,
  isUnread,
  mandatoryReason,
  modeLabel,
  notificationsCopyOf,
  readParams,
  visibleNotifications,
  type InboxNotification,
  type NotificationType,
} from './inbox';

/**
 * Moved with the rules from the web's `lib/notifications/describe.test.ts` (#160). The copy is the
 * catalogue's own, never retyped: a test with the sentences typed in would pass whatever the
 * catalogue says.
 */
const CATALOGUES = { az, en, ru, tr } as const;
const COPY = notificationsCopyOf(en.account.notifications);

/**
 * Every type the service publishes, read from the contract rather than retyped — #138.
 * `OpenApiContractTests` fails when `apps/api/openapi.json` stops describing the Java
 * `NotificationType`, so this list is the backend's.
 */
const CONTRACT = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../apps/api/openapi.json'), 'utf8'),
) as { components: { schemas: { NotificationResponse: { properties: { type: { enum: string[] } } } } } };
const TYPES = CONTRACT.components.schemas.NotificationResponse.properties.type.enum as NotificationType[];

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
  dueAt: '2026-10-05',
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

describe('the contract', () => {
  it('publishes 26 types', () => {
    expect(TYPES).toHaveLength(26);
  });
});

describe('readParams', () => {
  it('answers an empty document rather than throwing on anything that is not one', () => {
    expect(readParams(undefined)).toEqual({});
    expect(readParams(null)).toEqual({});
    expect(readParams('not an object')).toEqual({});
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

  it('builds no link from half a pair', () => {
    expect(campaignOf({ creatorSlug: 'aysel-studio' }).href).toBeNull();
    expect(campaignOf({ projectSlug: 'xari-bulbul-ceramics' }).href).toBeNull();
  });

  it('answers nulls for a row written before the title existed', () => {
    expect(campaignOf({ projectId: 'x' })).toEqual({ title: null, href: null });
  });

  it('escapes a slug rather than concatenating it into a path', () => {
    expect(campaignOf({ creatorSlug: 'a b', projectSlug: 'c/d' }).href).toBe('/projects/a%20b/c%2Fd');
  });
});

describe('hrefOf', () => {
  it('is locale-less: the app’s route names and the web’s paths before its locale segment', () => {
    expect(hrefOf(notification({ type: 'GOAL_REACHED' }))).toBe('/projects/aysel-studio/xari-bulbul-ceramics');
    expect(hrefOf(notification({ type: 'NEW_DEVICE_SIGN_IN', category: 'SECURITY' }))).toBe('/settings/sessions');
    expect(hrefOf(notification({ type: 'GOAL_REACHED', params: { creatorSlug: 'a' } }))).toBeNull();
  });
});

describe('describeNotification', () => {
  it('names the campaign when the document carries a title', () => {
    const view = describeNotification(notification({ type: 'GOAL_REACHED' }), COPY, 'en');

    expect(view.campaign).toBe('Xari Bulbul Ceramics');
    expect(view.headline).toBe('Xari Bulbul Ceramics reached its goal of 5,000.00 AZN');
    expect(view.href).toBe('/projects/aysel-studio/xari-bulbul-ceramics');
  });

  it('still forms a sentence when the document names no campaign', () => {
    const view = describeNotification(
      notification({ type: 'GOAL_REACHED', params: { goal: { amount: '5000.00', currency: 'AZN' } } }),
      COPY,
      'en',
    );

    expect(view.campaign).toBeNull();
    expect(view.headline).toBe('A campaign reached its goal of 5,000.00 AZN');
    expect(view.href).toBeNull();
  });

  it.each(TYPES)('renders %s as a finished sentence with a full document', (type) => {
    const view = describeNotification(notification({ type }), COPY, 'en');

    expect(view.headline).not.toBe('');
    expect(view.headline).not.toContain('  ');
    expect(view.headline).not.toContain('undefined');
    expect(view.headline).not.toContain('null');
    expect(view.headline).not.toContain('{');
    expect(view.headline).not.toBe(type);
  });

  it.each(TYPES)('renders %s as a finished sentence with an empty document', (type) => {
    const view = describeNotification(notification({ type, params: {} }), COPY, 'en');

    expect(view.headline).not.toBe('');
    expect(view.headline).not.toContain('  ');
    expect(view.headline).not.toContain('undefined');
    expect(view.headline).not.toContain('null');
    expect(view.headline).not.toContain('{');
    expect(view.headline).not.toBe(type);
  });

  it('falls back to the catalogue’s words for an amount that did not arrive as a string', () => {
    const view = describeNotification(
      notification({ type: 'PLEDGE_CONFIRMED', params: { total: { amount: 120, currency: 'AZN' } } }),
      COPY,
      'en',
    );

    expect(view.headline).toBe('Your pledge of your chosen amount to a campaign is confirmed');
  });

  it('groups thousands and keeps the scale the service sent', () => {
    const view = describeNotification(notification({ type: 'CAMPAIGN_SUCCEEDED' }), COPY, 'en');

    expect(view.headline).toContain('6,250.00 AZN');
  });

  it('sends the sign-in alert to the device list', () => {
    const view = describeNotification(
      notification({ type: 'NEW_DEVICE_SIGN_IN', category: 'SECURITY' }),
      COPY,
      'en',
    );

    expect(view.href).toBe('/settings/sessions');
  });

  it('survives a document that is not an object at all', () => {
    const view = describeNotification(
      notification({ type: 'PLEDGE_CONFIRMED', params: 'oops' as unknown as Record<string, unknown> }),
      COPY,
      'en',
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
});

describe('grouping by day', () => {
  const NOW = new Date('2026-08-20T12:00:00.000Z');

  it('puts two instants on the same local day under one key', () => {
    const justAfterMidnight = new Date(2026, 7, 19, 0, 30).toISOString();
    const lateEvening = new Date(2026, 7, 19, 23, 30).toISOString();

    expect(dayKeyOf(justAfterMidnight)).toBe(dayKeyOf(lateEvening));
  });

  it('puts two local days under different keys', () => {
    expect(dayKeyOf(new Date(2026, 7, 19, 12, 0).toISOString())).not.toBe(
      dayKeyOf(new Date(2026, 7, 20, 12, 0).toISOString()),
    );
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

  it('names the day in the reader’s language, capitalised the way that language does it', () => {
    expect(dayLabelOf(NOW.toISOString(), NOW, 'az')).toBe('Bu gün');
    expect(dayLabelOf(NOW.toISOString(), NOW, 'ru')).toBe('Сегодня');
    expect(dayLabelOf(NOW.toISOString(), NOW, 'tr')).toBe('Bugün');
    expect(dayLabelOf('2026-08-19T09:00:00.000Z', NOW, 'ru')).toBe('Вчера');
  });

  it('splits rows into consecutive runs of one day', () => {
    const rows = [
      { id: 'a', occurredAt: new Date(2026, 7, 20, 9).toISOString() },
      { id: 'b', occurredAt: new Date(2026, 7, 20, 8).toISOString() },
      { id: 'c', occurredAt: new Date(2026, 7, 19, 22).toISOString() },
    ];
    expect(groupByDay(rows).map(([, run]) => run.map((row) => row.id))).toEqual([['a', 'b'], ['c']]);
  });
});

describe('filters over the loaded rows', () => {
  const rows = [
    notification({ id: 'a', type: 'GOAL_REACHED', category: 'CAMPAIGN' }),
    notification({ id: 'b', type: 'PAYMENT_FAILED', category: 'PAYMENTS', readAt: '2026-08-19T10:00:00Z' }),
    notification({ id: 'c', type: 'PAYMENT_COLLECTED', category: 'PAYMENTS', readAt: null }),
  ];

  it('keeps one category, unread only, or both', () => {
    expect(visibleNotifications(rows, 'ALL', false).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(visibleNotifications(rows, 'PAYMENTS', false).map((row) => row.id)).toEqual(['b', 'c']);
    expect(visibleNotifications(rows, 'ALL', true).map((row) => row.id)).toEqual(['a', 'c']);
    expect(visibleNotifications(rows, 'PAYMENTS', true).map((row) => row.id)).toEqual(['c']);
  });

  it('reads an absent and a null readAt as unread', () => {
    expect(isUnread({})).toBe(true);
    expect(isUnread({ readAt: null })).toBe(true);
    expect(isUnread({ readAt: '2026-08-19T10:00:00Z' })).toBe(false);
  });
});

describe('cursorOf', () => {
  it('is both halves or none', () => {
    expect(cursorOf({ nextCursor: 't', nextCursorId: 'i' })).toEqual({ before: 't', beforeId: 'i' });
    expect(cursorOf({ nextCursor: 't' })).toBeNull();
    expect(cursorOf({})).toBeNull();
  });
});

describe('UPDATE_DUE_SOON — #138', () => {
  it('names the campaign and the day the update is due', () => {
    const view = describeNotification(notification({ type: 'UPDATE_DUE_SOON' }), COPY, 'en');

    expect(view.headline).toBe('Your update for Xari Bulbul Ceramics is due by 5 October 2026');
    expect(view.href).toBe('/projects/aysel-studio/xari-bulbul-ceramics');
  });

  it('reads the day in UTC, so no reader sees the day before', () => {
    const view = describeNotification(
      notification({ type: 'UPDATE_DUE_SOON', params: { dueAt: '2026-10-05' } }),
      COPY,
      'en',
    );

    expect(view.headline).toBe('An update for your campaign is due by 5 October 2026');
  });

  it('says "soon" rather than inventing a date when the document has none', () => {
    const view = describeNotification(
      notification({ type: 'UPDATE_DUE_SOON', params: { projectTitle: 'Lamp', dueAt: 'next week' } }),
      COPY,
      'en',
    );

    expect(view.headline).toBe('Your update for Lamp is due soon');
  });
});

describe('the catalogue covers the contract — #138', () => {
  it.each(Object.keys(CATALOGUES) as (keyof typeof CATALOGUES)[])(
    '%s has a headline and an unnamed sentence for every type, and every one is a sentence',
    (locale) => {
      const copy = notificationsCopyOf(CATALOGUES[locale].account.notifications);
      const { headline, unnamed } = copy;

      expect(TYPES.filter((type) => typeof headline[type] !== 'string')).toEqual([]);
      expect(TYPES.filter((type) => typeof unnamed[type] !== 'string')).toEqual([]);
      for (const type of TYPES) {
        for (const params of [FULL_PARAMS, {}]) {
          const view = describeNotification(notification({ type, params }), copy, locale);
          expect(view.headline).not.toBe(type);
          expect(view.headline).not.toContain('{');
        }
      }
    },
  );
});
