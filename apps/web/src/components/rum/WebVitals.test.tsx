import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WebVitals } from './WebVitals';
import { SESSION_SLOT } from '../../lib/rum/sampling';

/**
 * Next's hook is replaced, because the real one attaches six
 * `PerformanceObserver`s that jsdom does not implement. What is under test here
 * is the component's contract with the page — that it renders nothing and
 * subscribes exactly once — not the browser's observers, which
 * `reporter.test.ts` covers through the reporter itself.
 */
const subscriptions: ((metric: { name: string; value: number }) => void)[] = [];
vi.mock('next/web-vitals', () => ({
  useReportWebVitals: (callback: (metric: { name: string; value: number }) => void) => {
    subscriptions.push(callback);
  },
}));

afterEach(() => {
  cleanup();
  subscriptions.length = 0;
  delete (window as { [SESSION_SLOT]?: unknown })[SESSION_SLOT];
  vi.unstubAllGlobals();
});

describe('WebVitals', () => {
  /*
   * A monitoring component that rendered anything could shift the layout it was
   * measuring, and the cumulative layout shift figure would then include the
   * cost of collecting it — the one bug this feature could not detect in itself.
   * There is also therefore nothing to give an accessible name to and nothing
   * for `prefers-reduced-motion` to have an opinion about.
   */
  it('renders nothing at all', () => {
    const { container } = render(<WebVitals />);

    expect(container.innerHTML).toBe('');
    expect(container.childNodes).toHaveLength(0);
  });

  /*
   * Next's documentation: "New functions passed to `useReportWebVitals` are
   * called with the available metrics up to that point." A callback whose
   * identity changed per render would re-deliver every metric collected so far,
   * every render.
   */
  it('subscribes with one stable callback across renders', () => {
    const { rerender } = render(<WebVitals />);
    rerender(<WebVitals />);
    rerender(<WebVitals />);

    expect(subscriptions.length).toBeGreaterThan(0);
    expect(new Set(subscriptions).size).toBe(1);
  });

  it('sends a beacon when the page goes away', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    render(<WebVitals />);
    subscriptions[0]?.({ name: 'LCP', value: 1822 });
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe('/api/rum');
    // The body is a `Blob`, which is what carries the media type the endpoint
    // requires; `beacon.test.ts` reads its contents.
    expect(sendBeacon.mock.calls[0]?.[1]).toBeInstanceOf(Blob);
  });

  it('collects nothing for a session that was not sampled', () => {
    (window as { [SESSION_SLOT]?: unknown })[SESSION_SLOT] = {
      id: '0f4b7a2c-1d3e-4f5a-8b9c-0d1e2f3a4b5c',
      sampled: false,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    };
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    render(<WebVitals />);
    subscriptions[0]?.({ name: 'LCP', value: 1822 });
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
