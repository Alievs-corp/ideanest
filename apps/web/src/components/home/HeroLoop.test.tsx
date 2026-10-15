import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { HeroLoop } from './HeroLoop';

let report: ((visible: boolean) => void) | undefined;
let reduced = false;
let wide = false;

beforeEach(() => {
  report = undefined;
  reduced = false;
  wide = false;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        report = (visible) => callback([{ isIntersecting: visible }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        media: query,
        matches: query.includes('reduced-motion') ? reduced : wide,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SOURCES = [{ media: '(min-width: 1280px)', src: '/wide.mp4' }, { src: '/narrow.mp4' }];

function mount() {
  const { container } = render(<HeroLoop sources={SOURCES} poster="/still.webp" className="" />);
  const video = container.querySelector('video');
  if (video === null) throw new Error('no video');
  return video;
}

describe('HeroLoop (#490)', () => {
  it('loads nothing and stays still until it is on screen', () => {
    const video = mount();

    expect(video).not.toHaveAttribute('src');
    expect(video.muted).toBe(true);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('plays the first source whose media query matches once it is seen, and pauses off screen', () => {
    wide = true;
    const video = mount();

    act(() => report?.(true));
    expect(video.src).toMatch(/\/wide\.mp4$/);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    act(() => report?.(false));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('falls back to the source without a query', () => {
    const video = mount();

    act(() => report?.(true));
    expect(video.src).toMatch(/\/narrow\.mp4$/);
  });

  it('keeps the poster for a reader who asked for reduced motion', () => {
    reduced = true;
    const video = mount();

    act(() => report?.(true));
    expect(video).not.toHaveAttribute('src');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});
