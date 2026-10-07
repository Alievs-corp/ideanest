import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, StyleSheet, View, type EmitterSubscription, type KeyboardEvent } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { setLocale } from '../../lib/locale';
import { spacing } from '../../theme';
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

  it('keeps Start editing in a bar under the form, out of the scroll, above the keyboard', async () => {
    const handlers = new Map<string, (event: KeyboardEvent) => void>();
    const listen = jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, handler: (event: KeyboardEvent) => void) => {
      handlers.set(name, handler);
      return { remove: () => handlers.delete(name) } as unknown as EmitterSubscription;
    }) as unknown as typeof Keyboard.addListener);
    // The frame runs from under the header (91) to the bottom of an 844pt window.
    const place = jest
      .spyOn(View.prototype as unknown as { measureInWindow: (callback: (...frame: number[]) => void) => void }, 'measureInWindow')
      .mockImplementation(function (this: { props: { testID?: string } }, callback: (...frame: number[]) => void) {
        if (this.props.testID === 'new-project-frame') callback(0, 91, 390, 753);
      });
    await show();

    // Not inside the scroll view, so the keyboard cannot scroll it out of sight.
    let node = start().parent;
    while (node !== null) {
      expect(node.type).not.toBe('RCTScrollView');
      node = node.parent;
    }
    const footer = () => StyleSheet.flatten(screen.getByTestId('new-project-footer').props.style);
    const frame = () => StyleSheet.flatten(screen.getByTestId('new-project-frame').props.style);
    // Above the home indicator while the keyboard is down…
    expect(footer().paddingBottom).toBe(34);
    expect(frame().paddingBottom).toBe(0);

    // …and straight above the keyboard while it is up (the frame pads by what it covers).
    await act(async () =>
      handlers.get('keyboardWillChangeFrame')?.({
        endCoordinates: { screenX: 0, screenY: 508, width: 390, height: 336 },
      } as KeyboardEvent),
    );
    expect(footer().paddingBottom).toBe(spacing[3]);
    // The frame gives up exactly the covered part of itself, so the bar ends at the keyboard's top.
    expect(frame().paddingBottom).toBe(91 + 753 - 508);

    await act(async () => handlers.get('keyboardWillHide')?.({} as KeyboardEvent));
    expect(footer().paddingBottom).toBe(34);
    expect(frame().paddingBottom).toBe(0);
    listen.mockRestore();
    place.mockRestore();
  });

  it('wraps the button’s label rather than truncating it at a large font', async () => {
    await show();
    const label = screen.getByText(en.campaignEditor.newProject.start, { includeHiddenElements: true });
    expect(label.props.numberOfLines).toBeUndefined();
  });
});
