import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import NotFoundScreen from '../app/+not-found';
import * as locale from '../lib/locale';
import { colors } from '../theme';
import { RootFailure, fatalCopy } from './root-failure';
import { RouteErrorBoundary } from './route-error-boundary';
import { api, traceIdOfError } from '../api/client';

/**
 * The failure screens that are not maintenance — issue #150: not found, a render error inside a
 * route, and the root failure outside every provider.
 *
 * <p>Here rather than beside the routes because every file under `src/app` is a route to Expo
 * Router, and a test file there would be offered as a screen.
 */

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

/*
 * Expo Router's own boundary, `Try`, is what calls `ErrorBoundary` with `retry`, and the router
 * module is mocked above — so it is loaded from its file. Its one dependency that reaches native
 * code hides the splash screen, which a test does not have.
 */
jest.mock('expo-router/build/views/Splash', () => ({ hideAsync: () => {} }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Try } = require('expo-router/build/views/Try') as {
  Try: (props: { catch: typeof RouteErrorBoundary; children: ReactNode }) => ReactNode;
};

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const copy = en.shell.failure.pages.error;
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

/** A read through the app's own client that the service refused, with these headers. */
async function failedRead(headers: Record<string, string> = {}): Promise<Error> {
  global.fetch = jest.fn(async () =>
    new Response(JSON.stringify({ title: 'Internal detail' }), {
      status: 500,
      headers: { 'content-type': 'application/problem+json', ...headers },
    }),
  ) as unknown as typeof fetch;
  return api()
    .get('/v1/discover')
    .then(
      () => new Error('the read was expected to fail'),
      (cause: unknown) => cause as Error,
    );
}

/* FailureState pulls in the WhatsApp sheet's module graph; a cold first render is slow on CI. */
jest.setTimeout(20_000);

function inApp(node: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {node}
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // React logs every error a boundary catches; that is the point of these tests, not noise.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.mocked(console.error).mockRestore();
});

describe('not found', () => {
  it('uses the catalogue and sends the action to Home', async () => {
    await inApp(<NotFoundScreen />);
    expect(screen.getByRole('header', { name: en.shell.failure.pages.notFound.title })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: en.shell.failure.pages.notFound.action }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});

describe('a render error inside a route', () => {
  it('says so in the catalogue’s words and never prints the message', async () => {
    const retry = jest.fn(async () => {});
    await inApp(<RouteErrorBoundary error={new Error('secret stack detail')} retry={retry} />);

    expect(screen.getByRole('header', { name: copy.title })).toBeTruthy();
    expect(screen.getByText(copy.description)).toBeTruthy();
    expect(screen.queryByText(/secret stack detail/)).toBeNull();
    expect(screen.queryByText(new RegExp(copy.referenceLabel))).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('prints the X-Trace-Id as the reference when the failure was a response', async () => {
    const error = await failedRead({ 'X-Trace-Id': TRACE });
    await inApp(<RouteErrorBoundary error={error} retry={async () => {}} />);

    expect(screen.getByText(TRACE)).toBeTruthy();
    expect(screen.getByText(new RegExp(copy.referenceHint))).toBeTruthy();
    expect(screen.queryByText(/Internal detail/)).toBeNull();
  });

  it('has no reference line for a response that carried no trace id', async () => {
    await inApp(<RouteErrorBoundary error={await failedRead()} retry={async () => {}} />);
    expect(screen.queryByText(new RegExp(copy.referenceLabel))).toBeNull();
  });

  it('keeps the trace id of the read that failed, and of nothing else', async () => {
    expect(traceIdOfError(await failedRead({ 'X-Trace-Id': TRACE }))).toBe(TRACE);
    expect(traceIdOfError(await failedRead({ 'X-Trace-Id': 'not a trace id' }))).toBeNull();
    expect(traceIdOfError(new ApiError(500))).toBeNull();
    expect(traceIdOfError(Object.assign(new Error('x'), { traceId: TRACE }))).toBeNull();
    expect(traceIdOfError('a string')).toBeNull();
  });

  it('re-renders the screen on "Try again", through Expo Router’s own boundary', async () => {
    let fail = true;
    function Screen() {
      const [label] = useState('screen content');
      if (fail) throw new Error('first render fails');
      return <Text>{label}</Text>;
    }
    await inApp(
      <Try catch={RouteErrorBoundary}>
        <Screen />
      </Try>,
    );
    expect(screen.getByRole('header', { name: copy.title })).toBeTruthy();

    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('screen content')).toBeTruthy();
    expect(screen.queryByRole('header', { name: copy.title })).toBeNull();
  });
});

describe('the root failure', () => {
  it('renders with no provider above it, in the language in use', async () => {
    locale.setLocale('az');
    const retry = jest.fn(async () => {});
    // No IntlProvider, no SafeAreaProvider, no QueryClient: exactly what it has in the app.
    await render(<RootFailure error={new Error('provider exploded')} retry={retry} />);

    const words = az.shell.failure.pages.fatal;
    expect(screen.getByRole('header', { name: words.title })).toBeTruthy();
    expect(screen.getByText(words.description)).toBeTruthy();
    expect(screen.queryByText(/provider exploded/)).toBeNull();

    const action = screen.getByRole('button', { name: words.action });
    await fireEvent.press(action);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('is a white pill, never lime', async () => {
    locale.setLocale('en');
    await render(<RootFailure error={new Error('x')} retry={async () => {}} />);
    const pill = screen.getByRole('button', { name: en.shell.failure.pages.fatal.action });
    const style = [pill.props.style].flat(Infinity).reduce((all, one) => ({ ...all, ...one }), {});
    expect(style.backgroundColor).toBe(colors.whiteSurface);
    expect(style.backgroundColor).not.toBe(colors.lime500);
  });

  it('falls back to English for a language the catalogues do not have', async () => {
    const read = jest.spyOn(locale, 'currentLocale').mockReturnValue('ka' as never);
    await render(<RootFailure error={new Error('x')} retry={async () => {}} />);
    expect(screen.getByRole('header', { name: en.shell.failure.pages.fatal.title })).toBeTruthy();
    read.mockRestore();
  });

  it('has its words in all four catalogues, and English for anything else', () => {
    expect(fatalCopy('az')).toEqual(az.shell.failure.pages.fatal);
    expect(fatalCopy('ru')).toEqual(ru.shell.failure.pages.fatal);
    expect(fatalCopy('tr')).toEqual(tr.shell.failure.pages.fatal);
    expect(fatalCopy('ka')).toEqual(en.shell.failure.pages.fatal);
  });
});
