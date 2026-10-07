import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { setLocale } from '../../lib/locale';
import { NewProjectScreen } from './new-project-form';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
const mockSend = jest.fn();
jest.mock('../../api/client', () => ({
  api: () => ({ get: jest.fn() }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <NewProjectScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return client;
}

const start = () => screen.getByTestId('new-project-start');

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('NewProjectScreen', () => {
  it('asks for a title before it creates anything', async () => {
    await show();
    expect(screen.getByText(en.campaignEditor.newProject.heading)).toBeTruthy();
    expect(screen.getByText(en.campaignEditor.newProject.intro)).toBeTruthy();
    expect(start().props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('validates the trimmed title: blank is refused, and so is anything over 60', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('new-project-title'), '    ');
    expect(start().props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(screen.getByTestId('new-project-title'), 'x'.repeat(63));
    expect(start().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('A title is 60 characters or fewer. Remove 3.')).toBeTruthy();

    // Spaces around a 60-character title are not counted against it.
    await fireEvent.changeText(screen.getByTestId('new-project-title'), `  ${'x'.repeat(60)}  `);
    expect(start().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('creates the draft with the trimmed title and REPLACES the route with its Basics', async () => {
    mockSend.mockResolvedValueOnce({ id: 'p9', title: 'Solar Lamp', state: 'DRAFT', lockedFields: [] });
    const client = await show();

    await fireEvent.changeText(screen.getByTestId('new-project-title'), '  Solar Lamp ');
    await fireEvent.press(start());
    await settle();

    expect(mockSend).toHaveBeenCalledWith('POST', '/v1/projects', { title: 'Solar Lamp' });
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/campaigns/[id]/edit/basics', params: { id: 'p9' } });
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.projectEdit('p9'))).toMatchObject({ title: 'Solar Lamp' });
  });

  it('submits from the keyboard', async () => {
    mockSend.mockResolvedValueOnce({ id: 'p9', title: 'Lamp' });
    await show();
    await fireEvent.changeText(screen.getByTestId('new-project-title'), 'Lamp');
    await fireEvent(screen.getByTestId('new-project-title'), 'submitEditing');
    await settle();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new ApiError(401, { status: 401 }), en.campaignEditor.newProject.signInFirst],
    [new ApiError(403, { status: 403 }), en.campaignEditor.newProject.notAllowed],
    [new ApiError(500, { status: 500 }), en.campaignEditor.newProject.notCreated],
    [new ApiError(422, { status: 422, detail: 'That title is taken.' }), 'That title is taken.'],
    [new TypeError('Network request failed'), en.campaignEditor.newProject.unreachable],
  ])('words a refusal: %s', async (cause, words) => {
    mockSend.mockRejectedValueOnce(cause);
    await show();
    await fireEvent.changeText(screen.getByTestId('new-project-title'), 'Lamp');
    await fireEvent.press(start());
    await settle();

    expect(screen.getByText(en.campaignEditor.newProject.notCreatedTitle)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // The form is usable again.
    expect(start().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('signed out, goes to sign in and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/campaigns/new' } });
    expect(screen.queryByTestId('new-project-title')).toBeNull();
  });
});
