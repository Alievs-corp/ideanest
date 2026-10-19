import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RailControls } from './RailControls';

/**
 * jsdom does no layout, so the rail's geometry is set by hand: a 300px window onto 900px of
 * cards. What is tested is the contract — one page per press, an arrow disabled at its end,
 * and no smooth scroll for a reader who asked for reduced motion.
 */
function mountRail(scrollLeft = 0) {
  const rail = document.createElement('ul');
  rail.id = 'rail';
  Object.defineProperties(rail, {
    clientWidth: { configurable: true, value: 300 },
    scrollWidth: { configurable: true, value: 900 },
  });
  rail.scrollLeft = scrollLeft;
  const scrollBy = vi.fn();
  rail.scrollBy = scrollBy as unknown as typeof rail.scrollBy;
  document.body.append(rail);
  return { rail, scrollBy };
}

function stubMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced, media: query }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('RailControls', () => {
  it('names both arrows and points them at the rail', () => {
    mountRail();
    render(<RailControls target="rail" previous="Previous campaigns" next="Next campaigns" />);

    for (const name of ['Previous campaigns', 'Next campaigns']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-controls', 'rail');
    }
  });

  it('disables the arrow at the end the rail is already at', () => {
    mountRail(0);
    render(<RailControls target="rail" previous="Previous" next="Next" />);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('moves one page per press, smoothly', () => {
    stubMotion(false);
    const { scrollBy } = mountRail(0);
    render(<RailControls target="rail" previous="Previous" next="Next" />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });
  });

  it('jumps rather than glides under reduced motion', () => {
    stubMotion(true);
    const { scrollBy } = mountRail(600);
    render(<RailControls target="rail" previous="Previous" next="Next" />);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(scrollBy).toHaveBeenCalledWith({ left: -300, behavior: 'auto' });
  });
});
