import { act } from 'react';
import { createRoot } from 'test-renderer';
import { forgetSpentTokens, useSpendOnce } from './link-token';

/**
 * `useSpendOnce` under a real Strict Mode root — issue #152.
 *
 * <p>Testing Library's `render` creates its root without `isStrictMode`, and a `<StrictMode>`
 * element inside it does not double-invoke effects there, so a screen test cannot see the second
 * mount-time effect this hook exists to absorb. The root is created here directly, with the flag,
 * which is what a development build of the app runs under.
 */

const outcome = { done: jest.fn(), failed: jest.fn() };

function Probe({
  token,
  request,
}: {
  token: string;
  request: (token: string) => Promise<void>;
}) {
  useSpendOnce(token, request, outcome);
  return null;
}

beforeEach(() => {
  forgetSpentTokens();
  jest.clearAllMocks();
});

it('spends the token once under Strict Mode, whose effects run twice on mount', async () => {
  const request = jest.fn(async (_token: string) => {});
  const root = createRoot({ isStrictMode: true });

  await act(async () => root.render(<Probe token="tok-1" request={request} />));
  // A re-render with a new callback identity is not a second spend either.
  await act(async () => root.render(<Probe token="tok-1" request={async () => request('again')} />));

  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('tok-1');
  // The surviving mount still hears the answer.
  expect(outcome.done).toHaveBeenCalled();
  await act(async () => root.unmount());
});

it('hands a refusal to the mount that is still there', async () => {
  const request = jest.fn(async (_token: string) => {
    throw new Error('refused');
  });
  const root = createRoot({ isStrictMode: true });

  await act(async () => root.render(<Probe token="tok-1" request={request} />));

  expect(request).toHaveBeenCalledTimes(1);
  expect(outcome.failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'refused' }));
  expect(outcome.done).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it('spends nothing without a token', async () => {
  const request = jest.fn(async (_token: string) => {});
  const root = createRoot({ isStrictMode: true });

  await act(async () => root.render(<Probe token="" request={request} />));

  expect(request).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
