import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealFocusedItem } from './scroll-row';

/**
 * The focus handler every sideways-scrolling tab row carries — issue #181.
 *
 * jsdom lays nothing out and `test-setup.ts` stubs `scrollIntoView`, so what is asserted is the
 * request: which element is asked to scroll, and with which options.
 */

function Row() {
  return (
    <ul data-testid="row" tabIndex={-1} onFocus={revealFocusedItem}>
      <li>
        <a href="#one">One</a>
      </li>
      <li>
        <button type="button">Two</button>
      </li>
    </ul>
  );
}

/** A `matchMedia` that answers `reduce` to the reduced-motion query and nothing else. */
function preferReducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        media: query,
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('revealFocusedItem', () => {
  it('scrolls the focused item into view by the smallest move on both axes', () => {
    preferReducedMotion(false);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    screen.getByRole('link', { name: 'One' }).focus();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'One' }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  });

  it('handles every item from the one listener on the row, whatever the element', () => {
    preferReducedMotion(false);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    screen.getByRole('button', { name: 'Two' }).focus();

    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: 'Two' }));
  });

  it('jumps rather than glides under prefers-reduced-motion', () => {
    preferReducedMotion(true);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    screen.getByRole('link', { name: 'One' }).focus();

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  });

  it('does not scroll the row when the row itself takes focus', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    fireEvent.focus(screen.getByTestId('row'));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
