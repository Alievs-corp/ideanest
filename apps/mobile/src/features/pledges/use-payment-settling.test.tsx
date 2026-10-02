import { act, renderHook } from '@testing-library/react-native';
import { PAYMENT_CHECKS, PAYMENT_CHECK_INTERVAL_MS } from '@ideanest/checkout/pledge';
import { usePaymentSettling } from './use-payment-settling';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function intervals(count: number) {
  for (let i = 0; i < count; i += 1) await tick(PAYMENT_CHECK_INTERVAL_MS);
}

describe('usePaymentSettling', () => {
  it('reads 20 times, 3 s apart, then stops', async () => {
    const reread = jest.fn();
    await renderHook(() => usePaymentSettling(true, true, reread));

    await tick(PAYMENT_CHECK_INTERVAL_MS - 1);
    expect(reread).not.toHaveBeenCalled();
    await tick(1);
    expect(reread).toHaveBeenCalledTimes(1);

    for (let i = 1; i < PAYMENT_CHECKS + 5; i += 1) await tick(PAYMENT_CHECK_INTERVAL_MS);
    expect(reread).toHaveBeenCalledTimes(PAYMENT_CHECKS);
  });

  it('stops as soon as nothing is settling', async () => {
    const reread = jest.fn();
    const hook = await renderHook(({ settling }: { settling: boolean }) => usePaymentSettling(settling, true, reread), {
      initialProps: { settling: true },
    });
    await intervals(2);
    expect(reread).toHaveBeenCalledTimes(2);

    await hook.rerender({ settling: false });
    await intervals(10);
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it('pauses in the background and resumes from the same count', async () => {
    const reread = jest.fn();
    const hook = await renderHook(({ active }: { active: boolean }) => usePaymentSettling(true, active, reread), {
      initialProps: { active: true },
    });
    await intervals(5);
    expect(reread).toHaveBeenCalledTimes(5);

    await hook.rerender({ active: false });
    await intervals(30);
    expect(reread).toHaveBeenCalledTimes(5);

    await hook.rerender({ active: true });
    await intervals(30);
    expect(reread).toHaveBeenCalledTimes(PAYMENT_CHECKS);
  });

  it('is cleared on unmount', async () => {
    const reread = jest.fn();
    const hook = await renderHook(() => usePaymentSettling(true, true, reread));
    await tick(PAYMENT_CHECK_INTERVAL_MS);
    await hook.unmount();
    await intervals(10);
    expect(reread).toHaveBeenCalledTimes(1);
  });
});
