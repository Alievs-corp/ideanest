import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FadeInDown } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import SavedScreen from '../app/saved';
import { useSavedProjects } from '../api/queries';
import { staggerDelay } from '../theme';
import { MotionBudgetProvider } from './ui';

/**
 * The Saved screen (#281): each project a raised card that opens the campaign, the first screenful
 * rising in once — and a project a refetch adds later, or Reduce Motion, never moving.
 *
 * <p>Here rather than beside `app/saved.tsx` because every file under `src/app` is a route.
 */

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

let mockSignedIn = true;
jest.mock('../lib/use-session', () => ({
  useSession: () => ({ signedIn: mockSignedIn, locked: false, unlocked: false }),
}));

jest.mock('../api/queries', () => ({
  ...jest.requireActual('../api/queries'),
  useSavedProjects: jest.fn(),
}));

// A cold first render of FlashList with Reanimated has taken more than 5 s on CI.
jest.setTimeout(20_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function saved(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    projectId: `project-${index}`,
    title: `Project ${index}`,
    creatorSlug: 'aysel',
    projectSlug: `project-${index}`,
  }));
}

function given(items: ReturnType<typeof saved>): void {
  jest.mocked(useSavedProjects).mockReturnValue({
    data: { items },
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useSavedProjects>);
}

function wrap(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {ui}
      </IntlProvider>
    </SafeAreaProvider>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The delays of every entry rise `FadeUp` builds: which list positions rose. */
function spyOnRises(): number[] {
  const delays: number[] = [];
  const build = FadeInDown.duration.bind(FadeInDown);
  jest.spyOn(FadeInDown, 'duration').mockImplementation((ms: number) => {
    const builder = build(ms);
    const delay = builder.delay.bind(builder);
    builder.delay = ((value: number) => {
      delays.push(value);
      return delay(value);
    }) as typeof builder.delay;
    return builder;
  });
  return delays;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignedIn = true;
});

afterEach(() => jest.restoreAllMocks());

describe('the Saved screen', () => {
  it('opens the campaign from its card', async () => {
    given(saved(2));
    await render(wrap(<SavedScreen />));
    await settle();

    await fireEvent.press(screen.getByRole('link', { name: 'Project 1' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'aysel', projectSlug: 'project-1' },
    });
  });

  it('raises the first screenful once, and not a project a refetch adds', async () => {
    const delays = spyOnRises();
    given(saved(3));
    const view = await render(wrap(<SavedScreen />));
    await settle();

    expect(delays).toEqual(expect.arrayContaining([0, 1, 2].map((index) => staggerDelay(index))));

    delays.length = 0;
    given([...saved(3), { projectId: 'project-new', title: 'New', creatorSlug: 'aysel', projectSlug: 'new' }]);
    await view.rerender(wrap(<SavedScreen />));
    await settle();

    expect(screen.getByRole('link', { name: 'New' })).toBeTruthy();
    expect(delays).not.toContain(staggerDelay(3));
  });

  it('raises nothing under a motion budget of none', async () => {
    const delays = spyOnRises();
    given(saved(3));
    await render(wrap(<MotionBudgetProvider level="none"><SavedScreen /></MotionBudgetProvider>));
    await settle();

    expect(screen.getByRole('link', { name: 'Project 0' })).toBeTruthy();
    expect(delays).toEqual([]);
  });

  it('signed out: the invitation to sign in', async () => {
    mockSignedIn = false;
    given([]);
    await render(wrap(<SavedScreen />));

    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
  });
});
