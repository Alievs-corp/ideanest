import type { ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as SecureStore from 'expo-secure-store';
import en from '@ideanest/messages/en.json';
import { readCampaignPage, type CampaignPage } from '../../../lib/campaign-page';
import { setLocale } from '../../../lib/locale';
import { rememberAccessToken, storeRefreshToken, useFlagStore } from '../../../lib/session';
import { memoryStore } from '../../../lib/storage';
import { useCommentsTab } from './comments-tab';
import type { CampaignTabBody, CampaignTabContext } from './contract';

/**
 * The Comments tab — issue #155's comment tests: the empty post, the 429's minutes, Withdraw for
 * the author only, the tombstone, pages appended with no cursor asked for twice, and the
 * single-thread view without a composer.
 *
 * <p>The tab's hook is rendered as the screen renders it — its rows, then its footer — over the
 * real TanStack Query and the app's own client and session; only `fetch` is a double.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.setTimeout(30_000);

const C = en.campaign.comments;
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ME = 'account-me';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const keychain = SecureStore as unknown as { __reset: () => void };

const CAMPAIGN = readCampaignPage(
  {
    id: ID,
    slug: 'solar-lamp',
    state: 'LIVE',
    title: 'Solar Lamp',
    creator: { slug: 'aysel', name: 'Aysel' },
    goal: { amount: '1000.00', currency: 'AZN' },
    pledged: { amount: '420.00', currency: 'AZN' },
    backersCount: 3,
  },
  'aysel',
) as CampaignPage;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    threadId: id,
    parentId: null,
    authorId: 'someone-else',
    body: `Comment ${id}`,
    byCreator: false,
    deleted: false,
    depth: 0,
    createdAt: '2026-09-01T10:00:00Z',
    acceptsReplies: true,
    ...overrides,
  };
}
const replyRow = (id: string, root: string, overrides: Record<string, unknown> = {}) =>
  row(id, { threadId: root, parentId: root, depth: 1, acceptsReplies: false, ...overrides });

const FIRST_PAGE = {
  threads: [
    { root: row('c1', { authorId: ME }), replies: [replyRow('c1-r1', 'c1')], nextReplyCursor: 'c1-r1' },
    { root: row('c2', { byCreator: true }), replies: [], nextReplyCursor: null },
    {
      root: row('c3', { deleted: true, body: null, authorId: null }),
      replies: [replyRow('c3-r1', 'c3')],
      nextReplyCursor: null,
    },
  ],
  nextCursor: 'cursor-2',
};
const SECOND_PAGE = {
  threads: [{ root: row('c4'), replies: [], nextReplyCursor: null }],
  nextCursor: null,
};

type Route = (url: URL) => Response | Promise<Response>;
let routes: { comments: Route; post: Route; reply: Route; withdraw: Route; me: Route };
let reads: string[];
/** The `Authorization` each comments read carried, in order — `null` for none. */
let readAuthorization: (string | null)[];
let writes: string[];
let client: QueryClient;
let latest: CampaignTabBody;
let context: { setParam: jest.Mock; scrollToTabs: jest.Mock };

beforeEach(async () => {
  await act(async () => setLocale('en'));
  keychain.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  jest.clearAllMocks();
  reads = [];
  readAuthorization = [];
  writes = [];
  routes = {
    comments: (url) => json(url.searchParams.get('cursor') === 'cursor-2' ? SECOND_PAGE : FIRST_PAGE),
    post: () => json(row('new'), 201),
    reply: () => json(replyRow('new-reply', 'c1'), 201),
    withdraw: () => new Response(null, { status: 204 }),
    me: () => json({ id: ME, name: 'Me', slug: 'me' }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/v1/auth/refresh') return problem(401);
    if (url.pathname === '/v1/me') return routes.me(url);
    if (method === 'GET' && url.pathname === `/v1/projects/${ID}/comments`) {
      reads.push(url.search);
      readAuthorization.push(new Headers(init?.headers).get('Authorization'));
      return routes.comments(url);
    }
    writes.push(`${method} ${url.pathname} ${typeof init?.body === 'string' ? init.body : ''}`.trim());
    if (url.pathname === `/v1/projects/${ID}/comments`) return routes.post(url);
    if (/^\/v1\/comments\/[^/]+\/reply$/.test(url.pathname)) return routes.reply(url);
    if (method === 'DELETE' && url.pathname.startsWith('/v1/comments/')) return routes.withdraw(url);
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  client?.clear();
  jest.restoreAllMocks();
});

async function signIn() {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('access-1');
}

/** The tab as the screen draws it: every row, then the footer. */
function Harness({ tabContext }: { readonly tabContext: CampaignTabContext }) {
  latest = useCommentsTab(tabContext);
  return (
    <View>
      {latest.rows.map((item) => (
        <View key={item.key}>{item.render()}</View>
      ))}
      {latest.footer}
    </View>
  );
}

async function show({
  thread,
  offline = false,
  staleTime = 0,
}: { thread?: string; offline?: boolean; staleTime?: number } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime } } });
  context = { setParam: jest.fn(), scrollToTabs: jest.fn() };
  const contextFor = (view: string | undefined): CampaignTabContext => ({
    campaign: CAMPAIGN,
    active: true,
    offline,
    params: view === undefined ? {} : { thread: view },
    setParam: context.setParam,
    scrollToTabs: context.scrollToTabs,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const result = await render(<Harness tabContext={contextFor(thread)} />, { wrapper });
  await settle();
  /** The same tab, over the same cache, with `?thread=` set to `view` (or cleared). */
  return async (view: string | undefined) => {
    await result.rerender(<Harness tabContext={contextFor(view)} />);
    await settle();
  };
}

/** A response held until the test lets it go. */
function held(): { promise: Promise<Response>; release: (response: Response) => void } {
  let release: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => (release = resolve));
  return { promise, release };
}

type FocusCall = [unknown, string];
/** The testIDs of everything screen-reader focus was sent to, in order. */
const focused = () =>
  (jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls as FocusCall[])
    .filter(([, type]) => type === 'focus')
    .map(([node]) => (node as { props?: { testID?: unknown } } | null)?.props?.testID);

/** Past the focus move's delay (`FOCUS_DELAY_MS`), so the effect has sent it. */
async function afterFocusDelay() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const rateLimited = (minutes: number) =>
  C.failures.rateLimitedFor.other.replace('{count}', String(minutes));

describe('the list', () => {
  it('reads ten conversations at a time and draws the heading, the threads and their replies', async () => {
    await show();
    expect(reads).toEqual(['?limit=10']);
    expect(screen.getByRole('header', { name: C.heading })).toBeTruthy();
    expect(screen.getByText('Comment c1')).toBeTruthy();
    expect(screen.getByText('Comment c1-r1')).toBeTruthy();
    expect(screen.getByTestId('show-replies-c1')).toBeTruthy();
    expect(screen.queryByTestId('show-replies-c2')).toBeNull();
  });

  it('reads the comments as nobody, even signed in, and after a write too', async () => {
    await signIn();
    await show();
    expect(readAuthorization).toEqual([null]);

    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    expect(writes).toHaveLength(1);
    expect(readAuthorization.every((value) => value === null)).toBe(true);
  });

  it("marks the campaign's own answer with its tag", async () => {
    await show();
    expect(screen.getByText(C.fromCreator)).toBeTruthy();
  });

  it('draws a withdrawn comment as a tombstone with nothing under it, and keeps its replies', async () => {
    await show();
    const tombstone = screen.getByTestId('comment-c3');
    expect(screen.getByText(C.withdrawn)).toBeTruthy();
    expect(screen.queryByTestId('reply-c3')).toBeNull();
    expect(screen.queryByTestId('withdraw-c3')).toBeNull();
    expect(tombstone).toBeTruthy();
    expect(screen.getByText('Comment c3-r1')).toBeTruthy();
  });

  it('says the comments could not be loaded when the read failed, and nobody has commented when empty', async () => {
    routes.comments = () => problem(500);
    await show();
    expect(screen.getByText(C.failed)).toBeTruthy();
    client.clear();

    routes.comments = () => json({ threads: [], nextCursor: null });
    await show();
    expect(screen.getByText(C.empty)).toBeTruthy();
    expect(latest.footer).toBeNull();
    expect(latest.onEndReached).toBeNull();
  });

  it('appends the next page without asking for the same cursor twice', async () => {
    await show();
    expect(screen.getByRole('button', { name: C.older })).toBeTruthy();

    await act(async () => {
      // Two "end reached" in the same frame, from the same render: one request.
      latest.onEndReached?.();
      latest.onEndReached?.();
    });
    await settle();
    expect(reads).toEqual(['?limit=10', '?limit=10&cursor=cursor-2']);

    // Appended after the first page, nothing repeated, and no further page to ask for.
    const ids = screen.getAllByTestId(/^thread-/).map((node) => node.props.testID);
    expect(ids).toEqual(['thread-c1', 'thread-c2', 'thread-c3', 'thread-c4']);
    expect(latest.onEndReached).toBeNull();
    expect(screen.queryByRole('button', { name: C.older })).toBeNull();

    latest.onEndReached?.();
    await settle();
    expect(reads).toHaveLength(2);
  });

  it('keeps a next page asked for during a re-read, and asks for it once the re-read settles', async () => {
    await show();
    const reread = held();
    routes.comments = (url) =>
      url.searchParams.get('cursor') === 'cursor-2' ? json(SECOND_PAGE) : reread.promise;
    await act(async () => {
      void latest.refresh();
    });
    await settle();
    expect(reads).toEqual(['?limit=10', '?limit=10']);

    // The end is reached while the first page is still being read again: not dropped.
    await act(async () => latest.onEndReached?.());
    await settle();
    expect(reads).toHaveLength(2);

    await act(async () => reread.release(json(FIRST_PAGE)));
    await settle();
    expect(reads).toEqual(['?limit=10', '?limit=10', '?limit=10&cursor=cursor-2']);
    expect(screen.getByTestId('thread-c4')).toBeTruthy();
  });

  it('offers a retry when the next page fails, and stops asking on its own', async () => {
    await show();
    routes.comments = () => problem(503);
    await act(async () => latest.onEndReached?.());
    await settle();
    expect(screen.getByText(en.mobile.campaign.comments.olderFailed)).toBeTruthy();
    expect(latest.onEndReached).toBeNull();

    routes.comments = (url) => json(url.searchParams.get('cursor') === 'cursor-2' ? SECOND_PAGE : FIRST_PAGE);
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.getByTestId('thread-c4')).toBeTruthy();
  });
});

describe('the composer', () => {
  it('offers a signed-out reader sign-in instead of a form', async () => {
    await show();
    expect(screen.getByText(C.signedOut)).toBeTruthy();
    expect(screen.queryByLabelText(C.composerLabel)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: C.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
  });

  it('refuses an empty post before sending anything', async () => {
    await signIn();
    await show();
    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), '   ');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    expect(screen.getByText(C.failures.emptyBody)).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it('says how many minutes to wait after a 429, rounded up from the seconds', async () => {
    await signIn();
    routes.post = () => problem(429, { retryAfterSeconds: 150 });
    await show();
    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    expect(screen.getByText(rateLimited(3))).toBeTruthy();
    expect(rateLimited(3)).toContain('about 3 minutes');
  });

  it('says the session expired on a 401, beside the way to sign in again', async () => {
    await signIn();
    routes.post = () => problem(401);
    await show();
    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    // The refresh was refused too, so the session has ended: the card offers sign-in, and the
    // sentence says why the comment was not posted.
    expect(screen.getByText(C.failures.sessionExpired)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.signIn })).toBeTruthy();
  });

  it('says the service could not be reached when nothing answered', async () => {
    await signIn();
    routes.post = () => Promise.reject(new TypeError('Network request failed'));
    await show();
    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    expect(screen.getByText(C.failures.unreachable)).toBeTruthy();
  });

  it('posts, clears the field, says so, and reads the first page again', async () => {
    await signIn();
    await show();
    await act(async () => latest.onEndReached?.());
    await settle();
    expect(reads).toHaveLength(2);

    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), 'Hello there');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    expect(writes).toEqual([`POST /v1/projects/${ID}/comments {"body":"Hello there"}`]);
    expect(screen.getByLabelText(C.composerLabel).props.value).toBe('');
    expect(screen.getByTestId('comment-composer-notice').props.children).toBe(C.posted);
    // The first page alone, from the top: the new conversation is at its head.
    expect(reads).toEqual(['?limit=10', '?limit=10&cursor=cursor-2', '?limit=10']);
    expect(screen.queryByTestId('thread-c4')).toBeNull();
  });

  it('frees the pill as soon as the post is accepted, and says "Posted." once the list is re-read', async () => {
    await signIn();
    await show();
    const reread = held();
    routes.comments = () => reread.promise;
    await fireEvent.changeText(screen.getByLabelText(C.composerLabel), 'Hello there');
    await fireEvent.press(screen.getByRole('button', { name: C.postComment }));
    await settle();
    expect(writes).toHaveLength(1);
    const post = screen.getByTestId('comment-composer-submit');
    expect(post.props.accessibilityState).toEqual(expect.objectContaining({ busy: false }));
    expect(screen.getByTestId('comment-composer-notice').props.children).toBe('');

    await act(async () => reread.release(json(FIRST_PAGE)));
    await settle();
    expect(screen.getByTestId('comment-composer-notice').props.children).toBe(C.posted);
  });

  it('is disabled offline and says why', async () => {
    await signIn();
    await show({ offline: true });
    const post = screen.getByRole('button', { name: C.postComment });
    expect(post.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByTestId('comment-composer-notice').props.children).toBe(
      en.mobile.campaign.comments.offline,
    );
    // Said once, by the composer: no second line under the heading.
    expect(screen.queryByTestId('comments-offline')).toBeNull();
  });

  it('says once why the writes are disabled offline where there is no composer to say it', async () => {
    await show({ offline: true });
    expect(screen.getAllByText(en.mobile.campaign.comments.offline)).toHaveLength(1);
    client.clear();

    await signIn();
    await show({ offline: true, thread: 'c1' });
    expect(screen.queryByTestId('comment-composer')).toBeNull();
    expect(screen.getAllByText(en.mobile.campaign.comments.offline)).toHaveLength(1);
  });
});

describe('replying and withdrawing', () => {
  it('offers Withdraw to nobody signed out', async () => {
    await show();
    expect(screen.queryByTestId('withdraw-c1')).toBeNull();
    expect(screen.getAllByTestId(/^reply-c/).length).toBeGreaterThan(0);
  });

  it('offers Withdraw to the author of a comment and to nobody else', async () => {
    await signIn();
    await show();
    expect(screen.getByTestId('withdraw-c1')).toBeTruthy();
    expect(screen.queryByTestId('withdraw-c2')).toBeNull();
    expect(screen.queryByTestId('withdraw-c1-r1')).toBeNull();
  });

  it('asks before withdrawing, then withdraws and reads the comments again', async () => {
    await signIn();
    await show();
    await fireEvent.press(screen.getByTestId('withdraw-c1'));
    expect(screen.getByText(C.withdrawWarning)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.keep })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: C.withdrawConfirm }));
    await settle();
    expect(writes).toEqual(['DELETE /v1/comments/c1']);
    expect(reads).toEqual(['?limit=10', '?limit=10']);
    expect(screen.queryByText(C.withdrawWarning)).toBeNull();
  });

  it('moves focus to the warning, and back to Withdraw when the comment is kept', async () => {
    await signIn();
    await show();
    await fireEvent.press(screen.getByTestId('withdraw-c1'));
    await afterFocusDelay();
    expect(focused().at(-1)).toBe('withdraw-warning-c1');

    await fireEvent.press(screen.getByRole('button', { name: C.keep }));
    await afterFocusDelay();
    expect(focused().at(-1)).toBe('withdraw-c1');
  });

  it('returns focus to Reply when the reply form closes, cancelled or posted', async () => {
    await signIn();
    await show();
    await fireEvent.press(screen.getByTestId('reply-c1'));
    await fireEvent.press(screen.getByRole('button', { name: C.cancel }));
    await afterFocusDelay();
    expect(focused().at(-1)).toBe('reply-c1');

    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    await fireEvent.press(screen.getByTestId('reply-c1'));
    await fireEvent.changeText(screen.getByLabelText(C.replyLabel), 'Thanks');
    await fireEvent.press(screen.getByRole('button', { name: C.postReply }));
    await settle();
    await afterFocusDelay();
    expect(focused().at(-1)).toBe('reply-c1');
  });

  it('withdrawn in the thread view, it is no longer drawn whole on the tab', async () => {
    await signIn();
    let withdrawn = false;
    const c1 = () =>
      withdrawn ? row('c1', { deleted: true, body: null, authorId: null }) : row('c1', { authorId: ME });
    routes.comments = (url) =>
      json(
        url.searchParams.get('thread') === 'c1'
          ? { threads: [{ root: c1(), replies: [replyRow('c1-r1', 'c1')], nextReplyCursor: null }], nextCursor: null }
          : { threads: [{ root: c1(), replies: [], nextReplyCursor: null }], nextCursor: null },
      );
    routes.withdraw = () => {
      withdrawn = true;
      return new Response(null, { status: 204 });
    };
    // A long staleTime: only the invalidation can make the tab read again.
    const go = await show({ staleTime: 600_000 });
    expect(screen.getByText('Comment c1')).toBeTruthy();

    await go('c1');
    await fireEvent.press(screen.getByTestId('withdraw-c1'));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawConfirm }));
    await settle();
    expect(screen.getByText(C.withdrawn)).toBeTruthy();

    await go(undefined);
    expect(reads.filter((search) => search === '?limit=10')).toHaveLength(2);
    expect(screen.queryByText('Comment c1')).toBeNull();
    expect(screen.getByText(C.withdrawn)).toBeTruthy();
  });

  it('says why a withdrawal failed, as an alert', async () => {
    await signIn();
    routes.withdraw = () => problem(500);
    await show();
    await fireEvent.press(screen.getByTestId('withdraw-c1'));
    await fireEvent.press(screen.getByRole('button', { name: C.withdrawConfirm }));
    await settle();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(C.failures.notWithdrawn)).toBeTruthy();
  });

  it('opens a reply form where the service accepts one, and posts the reply to that comment', async () => {
    await signIn();
    await show();
    expect(screen.queryByTestId('reply-c1-r1')).toBeNull();
    await fireEvent.press(screen.getByTestId('reply-c1'));
    expect(screen.getByLabelText(C.replyLabel)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(C.replyLabel), 'Thanks');
    await fireEvent.press(screen.getByRole('button', { name: C.postReply }));
    await settle();
    expect(writes).toEqual(['POST /v1/comments/c1/reply {"body":"Thanks"}']);
    // The form closes after posting.
    expect(screen.queryByLabelText(C.replyLabel)).toBeNull();
  });
});

describe('the single-thread view', () => {
  it('opens from "Show more replies" at the top of the tab', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: C.showReplies }));
    expect(context.setParam).toHaveBeenCalledWith('thread', 'c1');
    expect(context.scrollToTabs).toHaveBeenCalled();
  });

  it('shows the one conversation with no composer, and pages its replies with its own cursor', async () => {
    await signIn();
    routes.comments = (url) =>
      json(
        url.searchParams.get('cursor') === 'c1-r2'
          ? {
              threads: [
                { root: row('c1', { authorId: ME }), replies: [replyRow('c1-r3', 'c1')], nextReplyCursor: null },
              ],
              nextCursor: null,
            }
          : {
              threads: [
                {
                  root: row('c1', { authorId: ME }),
                  replies: [replyRow('c1-r1', 'c1'), replyRow('c1-r2', 'c1')],
                  nextReplyCursor: 'c1-r2',
                },
              ],
              nextCursor: null,
            },
      );
    await show({ thread: 'c1' });
    expect(reads).toEqual(['?limit=10&thread=c1']);
    expect(screen.queryByTestId('comment-composer')).toBeNull();
    expect(screen.queryByLabelText(C.composerLabel)).toBeNull();
    expect(screen.getByRole('button', { name: C.all })).toBeTruthy();
    expect(screen.getByText('Comment c1')).toBeTruthy();
    expect(screen.getByText('Comment c1-r2')).toBeTruthy();

    await act(async () => {
      latest.onEndReached?.();
      latest.onEndReached?.();
    });
    await settle();
    expect(reads).toEqual(['?limit=10&thread=c1', '?limit=10&cursor=c1-r2&thread=c1']);
    expect(screen.getByText('Comment c1-r3')).toBeTruthy();
    expect(latest.onEndReached).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: C.all }));
    expect(context.setParam).toHaveBeenCalledWith('thread', null);
    expect(context.scrollToTabs).toHaveBeenCalled();
  });
});

describe('reporting a comment', () => {
  it('offers "Report this comment" under each comment, but not under a tombstone', async () => {
    await show();
    const triggers = screen.getAllByRole('button', { name: en.moderation.report.triggerOn.comment });
    // c1, its reply, c2 and c3's reply; the withdrawn c3 has none.
    expect(triggers).toHaveLength(4);
  });
});
