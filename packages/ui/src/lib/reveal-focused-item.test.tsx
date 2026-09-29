import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealFocusedItem } from './reveal-focused-item';

/**
 * The focus handler every sideways-scrolling row carries.
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('revealFocusedItem', () => {
  it('scrolls the focused item into view by the smallest move on both axes', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    const one = screen.getByRole('link', { name: 'One' });
    one.focus();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(one);
  });

  it('jumps rather than glides, as the browser does for a focused element', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    screen.getByRole('link', { name: 'One' }).focus();

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  });

  it('handles every item from the one listener on the row, whatever the element', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    const two = screen.getByRole('button', { name: 'Two' });
    two.focus();

    expect(scrollIntoView.mock.contexts[0]).toBe(two);
  });

  it('does not scroll the row when the row itself takes focus', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Row />);

    fireEvent.focus(screen.getByTestId('row'));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
