import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import EN from '../../../messages/en.json';
import RU from '../../../messages/ru.json';
import { type FundingTranslator, liveFundingCopyFrom } from '../../lib/i18n/campaign-copy';
import type { Locale } from '../../lib/i18n/locale';
import { LiveFunding } from './LiveFunding';

/**
 * §12.1's counter, from the reader's side.
 *
 * The two properties that matter, and neither is visible in the pure functions
 * `lib/realtime/updates.test.ts` covers:
 *
 * - **The numbers are in the markup before anything connects**, which is what keeps this
 *   island from breaking #119. A crawler and a reader with no JavaScript see the campaign's
 *   real totals.
 * - **A window moves the amount and the percentage together.** A percentage frozen at the
 *   server's value while the amount beside it moved would be two numbers disagreeing on one
 *   page, which is worse than no live counter at all.
 * - **The words are the catalogue's and the backer count is declined** (#99). Both are
 *   asserted against `messages/*.json` rather than against a string typed here, because a
 *   test that repeated the English would have passed on the day this component was still
 *   printing it to a reader who had chosen Russian.
 */

/*
 * The `[locale]` segment, which `useRouteLocale` reads and nothing else here needs.
 *
 * Spread first so the real module survives: `i18n/navigation.ts` builds its wrappers at
 * import time off `redirect` and `permanentRedirect`, and a factory that replaced the module
 * wholesale leaves those undefined — a TypeError inside next-intl, nowhere near its cause.
 */
let routeLocale = 'en';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: routeLocale }),
}));

/**
 * The real catalogue, through the builder the server uses.
 *
 * The cast is at this edge, for the reason the campaign page's own suite casts `namespace`:
 * next-intl types a translator against the literal keys of the catalogue it was built from,
 * and `FundingTranslator` is the narrow shape a server component hands across the boundary. A
 * key that does not exist still fails, as the missing message it is.
 */
function copyFor(locale: Locale) {
  return liveFundingCopyFrom(
    createTranslator({
      locale,
      messages: locale === 'ru' ? RU : EN,
      namespace: 'campaign',
    }) as unknown as FundingTranslator,
  );
}

const PROJECT = '0193f2a1-0000-7000-8000-000000000001';

/** A socket the test drives, standing in for the browser's. */
class FakeSocket {
  static last: FakeSocket | null = null;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  close(): void {
    this.closed = true;
  }

  /** What the flusher would have sent at the end of a window. */
  deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const originalWebSocket = globalThis.WebSocket;

/*
 * The stand-in is installed on `globalThis` rather than injected through a prop, because what
 * is being asserted is that the hook reaches for the platform's `WebSocket` — a seam for the
 * test would be a seam production never uses, and the test would then pass whether or not the
 * real socket was ever opened.
 *
 * Cast through `unknown` rather than `any`: CLAUDE.md §3 forbids `any`, and the shape here is
 * genuinely not a `WebSocket` — it is the four members this component touches.
 */
type WebSocketGlobal = { WebSocket: unknown };

beforeEach(() => {
  routeLocale = 'en';
  FakeSocket.last = null;
  (globalThis as unknown as WebSocketGlobal).WebSocket = FakeSocket;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as WebSocketGlobal).WebSocket = originalWebSocket;
});

function renderFunding(realtimeOrigin: string | undefined, backersCount = 40) {
  return render(
    <LiveFunding
      projectId={PROJECT}
      goal={{ amount: '10000.00', currency: 'AZN' }}
      pledged={{ amount: '5000.00', currency: 'AZN' }}
      backersCount={backersCount}
      realtimeOrigin={realtimeOrigin}
      copy={copyFor(routeLocale as Locale)}
    />,
  );
}

describe('LiveFunding', () => {
  it('renders the server’s numbers with no socket configured', () => {
    renderFunding(undefined);

    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(FakeSocket.last).toBeNull();
  });

  it('opens a socket on the campaign’s counter channel when an origin is configured', () => {
    renderFunding('https://api.ideanest.az');

    expect(FakeSocket.last?.url).toBe(
      `wss://api.ideanest.az/v1/realtime?channel=${encodeURIComponent(`project:${PROJECT}`)}`,
    );
  });

  it('adds a window’s amount to the total and recomputes the percentage', () => {
    renderFunding('https://api.ideanest.az');

    act(() => {
      FakeSocket.last?.deliver({
        channel: `project:${PROJECT}`,
        pledges: 2,
        amount: { amount: '1000.00', currency: 'AZN' },
      });
    });

    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('accumulates across windows rather than replacing', () => {
    renderFunding('https://api.ideanest.az');

    act(() => {
      FakeSocket.last?.deliver({
        channel: `project:${PROJECT}`,
        pledges: 1,
        amount: { amount: '1000.00', currency: 'AZN' },
      });
      FakeSocket.last?.deliver({
        channel: `project:${PROJECT}`,
        pledges: 1,
        amount: { amount: '2000.00', currency: 'AZN' },
      });
    });

    expect(screen.getByText('80%')).toBeTruthy();
  });

  /*
   * A window carries how many pledges were confirmed, and a pledge is not always a new backer:
   * somebody raising their pledge confirms again. Adding it would make the count drift upwards
   * with no way to correct itself, which is worse than one that is right at page load.
   */
  it('does not move the backer count', () => {
    renderFunding('https://api.ideanest.az');

    act(() => {
      FakeSocket.last?.deliver({
        channel: `project:${PROJECT}`,
        pledges: 5,
        amount: { amount: '125.00', currency: 'AZN' },
      });
    });

    expect(screen.getByText('40')).toBeTruthy();
  });

  it('ignores a frame that is not a message from this server', () => {
    renderFunding('https://api.ideanest.az');

    act(() => {
      FakeSocket.last?.onmessage?.({ data: 'not json' });
      FakeSocket.last?.onmessage?.({ data: 42 });
      FakeSocket.last?.deliver({ nonsense: true });
    });

    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('closes the socket when the page goes away', () => {
    const view = renderFunding('https://api.ideanest.az');
    const socket = FakeSocket.last;

    view.unmount();

    expect(socket?.closed).toBe(true);
  });

  /*
   * ISSUE #99. Four words were typed here in English — the bar's accessible name and the
   * three labels under the figures — on a page whose every other component read the
   * catalogue, so a reader who chose Azerbaijani met a translated campaign whose funding
   * block said "pledged" and "backers".
   */
  it('draws its labels from the catalogue rather than from the component', () => {
    renderFunding(undefined);

    expect(screen.getByText(EN.campaign.funding.pledged)).toBeTruthy();
    expect(screen.getByText(EN.campaign.funding.ofGoal)).toBeTruthy();
    expect(screen.getByLabelText('Funding: 50 percent of the goal')).toBeTruthy();
  });

  it('says "funded" rather than "of goal" once the goal is reached', () => {
    render(
      <LiveFunding
        projectId={PROJECT}
        goal={{ amount: '10000.00', currency: 'AZN' }}
        pledged={{ amount: '10000.00', currency: 'AZN' }}
        backersCount={40}
        realtimeOrigin={undefined}
        copy={copyFor('en')}
      />,
    );

    expect(screen.getByText(EN.campaign.funding.funded)).toBeTruthy();
    expect(screen.queryByText(EN.campaign.funding.ofGoal)).toBeNull();
  });

  /*
   * THE DEFECT #99 NAMES. The ternary that stood here chose between "backer" and "backers",
   * which is the whole of English and none of Russian: 1 бэкер, 2 бэкера, 5 бэкеров. Three
   * counts, because a rule that only distinguished one from many would pass on two of them.
   */
  it.each([
    [1, RU.campaign.funding.backers.one],
    [2, RU.campaign.funding.backers.few],
    [40, RU.campaign.funding.backers.many],
  ])('declines the backer count in Russian: %i', (count, expected) => {
    routeLocale = 'ru';

    renderFunding(undefined, count);

    expect(screen.getByText(expected)).toBeTruthy();
  });
});