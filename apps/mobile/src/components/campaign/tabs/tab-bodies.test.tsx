import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { ProjectPage } from '../../../api/queries';
import { readCampaignPage, type CampaignPage } from '../../../lib/campaign-page';
import { formatDay } from '../../../lib/i18n';
import { setLocale } from '../../../lib/locale';
import type { CampaignTabBody, CampaignTabHook } from './contract';
import { useCreatorTab } from './creator-tab';
import { useFaqTab } from './faq-tab';
import { useUpdatesTab } from './updates-tab';

/**
 * The Creator, FAQ and Updates tabs — issue #155. Each hook is drawn the way the screen draws it
 * (its rows in order, then its footer, the placeholder while `loading` with no rows), over the
 * app's real client and TanStack Query; only `fetch` is a double, so "read only when the tab
 * opens" and "no duplicate cursor" are statements about requests, not about mocked hooks.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

jest.setTimeout(30_000);

const C = en.campaign;
const M = en.mobile.campaign;
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PAGE: ProjectPage = {
  id: ID,
  slug: 'solar-lamp',
  state: 'LIVE',
  title: 'Solar Lamp',
  blurb: 'A lamp that charges in the sun.',
  creator: { slug: 'aysel', name: 'Aysel', avatarUrl: 'https://cdn.example/aysel-campaign.jpg' },
  goal: { amount: '1000.00', currency: 'AZN' },
  pledged: { amount: '420.00', currency: 'AZN' },
  backersCount: 3,
  deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
};
const CAMPAIGN = readCampaignPage(PAGE, 'aysel') as CampaignPage;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number) =>
  new Response(JSON.stringify({ status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

/** A response the test releases when it chooses — to look at the screen while a page is in flight. */
function deferred() {
  let release: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type Route = (url: URL) => Response | Promise<Response>;
let routes: Record<string, Route>;
let requests: URL[];
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  routes = {};
  requests = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    const route = routes[url.pathname];
    return route === undefined ? problem(404) : route(url);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  client?.clear();
});

/** What the screen does with a tab's body, and nothing else. */
let body: CampaignTabBody;
function Harness({ hook, active }: { readonly hook: CampaignTabHook; readonly active: boolean }) {
  body = hook({
    campaign: CAMPAIGN,
    active,
    offline: false,
    params: {},
    setParam: () => undefined,
    scrollToTabs: () => undefined,
  });
  return (
    <View>
      {body.rows.map((row) => (
        <View key={row.key}>{row.render()}</View>
      ))}
      {body.loading && body.rows.length === 0 ? <Text testID="tab-placeholder" /> : null}
      {body.footer}
    </View>
  );
}

async function show(hook: CampaignTabHook, { active = true }: { active?: boolean } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(<Harness hook={hook} active={active} />, { wrapper });
  await settle();
  return {
    ...view,
    activate: async () => {
      await view.rerender(<Harness hook={hook} active />);
      await settle();
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const requested = (pathname: string) => requests.filter((url) => url.pathname === pathname);

/** A target's minimum height — 44pt, and a minimum so Dynamic Type grows it instead of clipping. */
function minHeight(node: { props: { style?: unknown } }): unknown {
  return StyleSheet.flatten(node.props.style as ViewStyle)?.minHeight;
}

/** The picture the decorative avatar draws (it is hidden from the accessibility tree). */
function avatarUri(): unknown {
  const avatar = screen.getByTestId('creator-avatar', { includeHiddenElements: true });
  const image = avatar.children.find(
    (child) => typeof child !== 'string' && child.props.source !== undefined,
  );
  return typeof image === 'string' ? undefined : image?.props.source?.uri;
}

/* ---------------------------------------------------------------------------------------------- */

describe('the Creator tab', () => {
  const PROFILE = {
    slug: 'aysel',
    name: 'Aysel Məmmədova',
    avatarUrl: 'https://cdn.example/aysel.jpg',
    bio: 'I make lamps.\nMostly solar ones.',
    joinedAt: '2025-03-14T09:00:00Z',
  };
  const project = (n: number, state = 'LIVE') => ({
    id: `p${n}`,
    title: `Campaign ${n}`,
    slug: `campaign-${n}`,
    creatorSlug: 'aysel',
    blurb: `What campaign ${n} is.`,
    state,
  });
  // Seven, as asked for: the campaign being read among them, and six others.
  const PROJECTS = {
    projects: [
      project(1, 'SUCCESSFUL'),
      { ...project(0), id: ID, title: 'Solar Lamp', slug: 'solar-lamp' },
      project(2, 'UNSUCCESSFUL'),
      project(3, 'SOMETHING_NEW'),
      project(4),
      project(5),
      project(6),
    ],
    nextCursor: 'more',
  };

  beforeEach(() => {
    routes['/v1/users/aysel'] = () => json(PROFILE);
    routes['/v1/users/aysel/projects'] = () => json(PROJECTS);
  });

  it('reads the profile and seven campaigns only once the tab opens', async () => {
    const view = await show(useCreatorTab, { active: false });
    expect(requested('/v1/users/aysel')).toHaveLength(0);
    expect(requested('/v1/users/aysel/projects')).toHaveLength(0);
    expect(screen.queryByText(C.creator.heading)).toBeNull();

    await view.activate();
    expect(requested('/v1/users/aysel')).toHaveLength(1);
    const [list] = requested('/v1/users/aysel/projects');
    expect(list?.searchParams.get('limit')).toBe('7');
    expect(screen.getByRole('header', { name: C.creator.heading })).toBeTruthy();
  });

  it('shows the placeholder, not a half-drawn panel, while the profile is on its way', async () => {
    const pending = deferred();
    routes['/v1/users/aysel'] = () => pending.promise;
    await show(useCreatorTab);
    expect(screen.getByTestId('tab-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('creator-about')).toBeNull();

    await act(async () => pending.release(json(PROFILE)));
    await settle();
    expect(screen.queryByTestId('tab-placeholder')).toBeNull();
    expect(screen.getByTestId('creator-about')).toBeTruthy();
  });

  it('draws the profile: the name as a link, the day they joined and the biography', async () => {
    await show(useCreatorTab);

    const name = screen.getByRole('link', { name: PROFILE.name });
    expect(minHeight(name)).toBe(44);
    await fireEvent.press(name);
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/u/[slug]',
      params: { slug: 'aysel' },
    });

    const day = formatDay(PROFILE.joinedAt, 'en') as string;
    expect(screen.getByTestId('creator-member-since')).toHaveTextContent(`Member since ${day}`);
    // Line breaks kept, as the web's `pre-line`.
    expect(screen.getByTestId('creator-bio').props.children).toBe(PROFILE.bio);
    // The profile's picture, hidden from a screen reader: the name beside it already says who.
    expect(avatarUri()).toBe(PROFILE.avatarUrl);
  });

  it('lists six other campaigns, never this one, each opening its page with its state as a word', async () => {
    await show(useCreatorTab);

    expect(screen.getByRole('header', { name: C.creator.others })).toBeTruthy();
    const rows = screen.getAllByTestId(/^creator-project-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'creator-project-p1',
      'creator-project-p2',
      'creator-project-p3',
      'creator-project-p4',
      'creator-project-p5',
      'creator-project-p6',
    ]);
    expect(screen.queryByTestId(`creator-project-${ID}`)).toBeNull();

    expect(screen.getByTestId('creator-project-p1')).toHaveTextContent(
      `Campaign 1What campaign 1 is.${C.state.SUCCESSFUL}`,
    );
    expect(screen.getByTestId('creator-project-p2')).toHaveTextContent(C.state.UNSUCCESSFUL, {
      exact: false,
    });
    // A state the catalogue has no word for is drawn without one, never as its enum.
    expect(screen.getByTestId('creator-project-p3')).not.toHaveTextContent('SOMETHING_NEW', {
      exact: false,
    });

    await fireEvent.press(screen.getByTestId('creator-project-p2'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'campaign-2' },
    });
    expect(screen.getByTestId('creator-project-p2').props.accessibilityRole).toBe('link');
    expect(minHeight(screen.getByTestId('creator-project-p2'))).toBe(44);

    const seeAll = C.creator.seeAll.replace('{name}', PROFILE.name);
    expect(minHeight(screen.getByRole('link', { name: seeAll }))).toBe(44);
    await fireEvent.press(screen.getByRole('link', { name: seeAll }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/u/[slug]',
      params: { slug: 'aysel' },
    });
  });

  it('falls back to the campaign’s name and avatar, with no link, when the profile is refused', async () => {
    routes['/v1/users/aysel'] = () => problem(404);
    await show(useCreatorTab);

    expect(screen.getByRole('header', { name: C.creator.heading })).toBeTruthy();
    expect(screen.getByTestId('creator-name')).toHaveTextContent('Aysel');
    expect(screen.queryByRole('link', { name: 'Aysel' })).toBeNull();
    expect(screen.queryByTestId('creator-member-since')).toBeNull();
    expect(screen.queryByTestId('creator-bio')).toBeNull();
    expect(avatarUri()).toBe('https://cdn.example/aysel-campaign.jpg');
    // The campaigns still list; the way to a profile that could not be read does not.
    expect(screen.getAllByTestId(/^creator-project-/)).toHaveLength(6);
    expect(screen.queryByTestId('creator-see-all')).toBeNull();
  });

  it('says nothing about other campaigns when there are none', async () => {
    routes['/v1/users/aysel/projects'] = () =>
      json({ projects: [{ ...project(0), id: ID }], nextCursor: null });
    await show(useCreatorTab);
    expect(screen.getByTestId('creator-about')).toBeTruthy();
    expect(screen.queryByTestId('creator-others')).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('the FAQ tab', () => {
  const FAQS = {
    faqs: [
      { id: 'f1', question: 'Does it ship to Germany?', answer: 'Yes.\nFrom March.' },
      { id: 'f2', question: 'Is it waterproof?', answer: 'Splash-proof, not waterproof.' },
    ],
  };
  const path = `/v1/projects/${ID}/faqs`;

  it('reads nothing until the tab opens', async () => {
    routes[path] = () => json(FAQS);
    const view = await show(useFaqTab, { active: false });
    expect(requested(path)).toHaveLength(0);
    await view.activate();
    expect(requested(path)).toHaveLength(1);
  });

  it('shows every answer at once, in the creator’s order — no accordion', async () => {
    routes[path] = () => json(FAQS);
    await show(useFaqTab);

    expect(screen.getByRole('header', { name: C.faqs.heading })).toBeTruthy();
    const questions = screen
      .getAllByRole('header')
      .filter((node) => node.props.accessibilityLabel?.startsWith('Question'));
    expect(questions.map((node) => node.props.accessibilityLabel)).toEqual([
      'Question 1 of 2: Does it ship to Germany?',
      'Question 2 of 2: Is it waterproof?',
    ]);
    expect(screen.getByText('Yes.\nFrom March.')).toBeTruthy();
    expect(screen.getByText('Splash-proof, not waterproof.')).toBeTruthy();
    // Nothing to open or close: there is no control in the tab at all.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says the read failed — not that there are no questions — and tries again', async () => {
    let answer: Response = problem(500);
    routes[path] = () => answer;
    await show(useFaqTab);

    expect(screen.getByText(C.faqs.failed)).toBeTruthy();
    expect(screen.queryByText(C.faqs.empty)).toBeNull();

    answer = json(FAQS);
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.queryByText(C.faqs.failed)).toBeNull();
    expect(screen.getByText('Is it waterproof?')).toBeTruthy();
  });

  it('says the campaign has answered nothing only when the list is empty', async () => {
    routes[path] = () => json({ faqs: [] });
    await show(useFaqTab);
    expect(screen.getByText(C.faqs.empty)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('refreshes by reading the list again', async () => {
    routes[path] = () => json(FAQS);
    await show(useFaqTab);
    await act(async () => {
      await body.refresh();
    });
    expect(requested(path)).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('the Updates tab', () => {
  const path = `/v1/projects/${ID}/updates`;
  const update = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: `Update title ${number}`,
    body: `What happened in ${number}.`,
    visibility: 'PUBLIC',
    publishedAt: '2026-09-30T21:30:00Z',
    ...extra,
  });
  /** Twenty updates numbered down from `top`, as one page, with the cursor the service sends. */
  const page = (top: number, nextCursor: number | null) => ({
    updates: Array.from({ length: 20 }, (_, i) => update(top - i)),
    nextCursor,
  });

  const olderPill = () => screen.queryByRole('button', { name: C.updates.older });

  it('reads nothing until the tab opens, then the newest twenty with no cursor', async () => {
    routes[path] = () => json(page(45, 25));
    const view = await show(useUpdatesTab, { active: false });
    expect(requested(path)).toHaveLength(0);

    await view.activate();
    const [first] = requested(path);
    expect(first?.searchParams.get('limit')).toBe('20');
    expect(first?.searchParams.has('cursor')).toBe(false);
    expect(screen.getByRole('header', { name: C.updates.heading })).toBeTruthy();
    expect(screen.getAllByTestId(/^update-\d+$/)).toHaveLength(20);
  });

  it('prints the service’s number, the device’s day, and a backers-only tag with a word', async () => {
    routes[path] = () =>
      json({
        updates: [update(7, { visibility: 'BACKERS_ONLY', body: 'Line one.\nLine two.' }), update(3)],
        nextCursor: null,
      });
    await show(useUpdatesTab);

    // The service's numbers — 7 and 3 — never the list's positions.
    expect(screen.getByText('Update 7')).toBeTruthy();
    expect(screen.getByText('Update 3')).toBeTruthy();
    expect(screen.queryByText('Update 1')).toBeNull();
    expect(screen.queryByText('Update 2')).toBeNull();

    // 21:30 UTC on the 30th is the 1st in Baku, the zone every suite runs in.
    const day = formatDay('2026-09-30T21:30:00Z', 'en') as string;
    expect(day).toContain('1');
    expect(screen.getAllByText(day)).toHaveLength(2);

    expect(screen.getByTestId('update-7-backers-only')).toHaveTextContent(C.updates.backersOnly);
    expect(screen.queryByTestId('update-3-backers-only')).toBeNull();

    expect(screen.getByRole('header', { name: 'Update title 7' })).toBeTruthy();
    expect(screen.getByText('Line one.\nLine two.')).toBeTruthy();
    // One page that ended: no pill and no "no older updates".
    expect(olderPill()).toBeNull();
    expect(screen.queryByText(C.updates.noOlder)).toBeNull();
  });

  it('appends the next twenty and never asks for the same cursor twice', async () => {
    const second = deferred();
    routes[path] = (url) => (url.searchParams.has('cursor') ? second.promise : json(page(40, 20)));
    await show(useUpdatesTab);

    expect(olderPill()).toBeTruthy();
    expect(body.onEndReached).not.toBeNull();

    // The end of the list, twice, and the pill — one request.
    await act(async () => {
      body.onEndReached?.();
      body.onEndReached?.();
    });
    await settle();
    const loading = screen.getByRole('button', { name: M.updates.loadingOlder });
    expect(loading.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(loading);
    await act(async () => body.onEndReached?.());
    const older = requested(path).filter((url) => url.searchParams.has('cursor'));
    expect(older).toHaveLength(1);
    expect(older[0]?.searchParams.get('cursor')).toBe('20');
    expect(older[0]?.searchParams.get('limit')).toBe('20');

    await act(async () => second.release(json(page(20, null))));
    await settle();

    // Appended: the first page's cards are still there, the second's follow them.
    const cards = screen.getAllByTestId(/^update-\d+$/).map((node) => node.props.testID);
    expect(cards).toHaveLength(40);
    expect(cards[0]).toBe('update-40');
    expect(cards[39]).toBe('update-1');

    // The end of a paged list says so, and nothing more is asked for.
    expect(screen.getByText(C.updates.noOlder)).toBeTruthy();
    expect(olderPill()).toBeNull();
    expect(body.onEndReached).toBeNull();
    expect(requested(path)).toHaveLength(2);
  });

  it('offers "Older updates" as a named control that loads the next page', async () => {
    routes[path] = (url) =>
      json(url.searchParams.has('cursor') ? page(20, null) : page(40, 20));
    await show(useUpdatesTab);
    await fireEvent.press(olderPill()!);
    await settle();
    expect(screen.getAllByTestId(/^update-\d+$/)).toHaveLength(40);
  });

  it('keeps the loaded cards when the next page fails, and retries only when asked', async () => {
    let olderAnswer: () => Response = () => problem(503);
    routes[path] = (url) => (url.searchParams.has('cursor') ? olderAnswer() : json(page(40, 20)));
    await show(useUpdatesTab);

    await act(async () => body.onEndReached?.());
    await settle();
    expect(screen.getAllByTestId(/^update-\d+$/)).toHaveLength(20);
    expect(screen.getByText(M.updates.olderFailed)).toBeTruthy();
    expect(olderPill()).toBeNull();
    // The end of the list does not hammer a page that failed.
    expect(body.onEndReached).toBeNull();

    olderAnswer = () => json(page(20, null));
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(screen.queryByText(M.updates.olderFailed)).toBeNull();
    expect(screen.getAllByTestId(/^update-\d+$/)).toHaveLength(40);
    expect(requested(path).filter((url) => url.searchParams.get('cursor') === '20')).toHaveLength(2);
  });

  it('says the read failed, not that nothing was posted', async () => {
    routes[path] = () => problem(500);
    await show(useUpdatesTab);
    expect(screen.getByText(C.updates.failed)).toBeTruthy();
    expect(screen.queryByText(C.updates.none)).toBeNull();
    expect(screen.getByRole('button', { name: en.common.tryAgain })).toBeTruthy();
  });

  it('says the campaign has posted nothing when the first page is empty', async () => {
    routes[path] = () => json({ updates: [], nextCursor: null });
    await show(useUpdatesTab);
    expect(screen.getByText(C.updates.none)).toBeTruthy();
    expect(olderPill()).toBeNull();
  });

  it('refreshes the first page only', async () => {
    routes[path] = (url) =>
      json(url.searchParams.has('cursor') ? page(20, null) : page(40, 20));
    await show(useUpdatesTab);
    await act(async () => body.onEndReached?.());
    await settle();
    expect(screen.getAllByTestId(/^update-\d+$/)).toHaveLength(40);

    requests = [];
    await act(async () => {
      await body.refresh();
    });
    await settle();
    expect(requested(path)).toHaveLength(1);
    expect(requested(path)[0]?.searchParams.has('cursor')).toBe(false);
    expect(screen.getAllByTestId(/^update-\d+$/)).toHaveLength(20);
    expect(olderPill()).toBeTruthy();
  });
});
