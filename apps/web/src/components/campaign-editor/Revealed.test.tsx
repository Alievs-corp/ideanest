import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Revealed } from './Revealed';

/**
 * Where the message is drawn is jsdom's to fake: it lays nothing out, so every box is
 * at 0,0 with no size. The rectangle is stubbed to put the message on or off screen.
 */
function placeAt(top: number, height = 80) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    width: 320,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

describe('Revealed', () => {
  let scrolled: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes the page to a message that appears above the fold', () => {
    placeAt(-1200);
    render(<Revealed>Not saved</Revealed>);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('leaves the page where it is when the message is already in view', () => {
    placeAt(200);
    render(<Revealed>Not saved</Revealed>);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('brings a message back when what it says changes, and not on every render', () => {
    placeAt(-1200);
    const { rerender } = render(<Revealed revealKey="first">Not saved</Revealed>);
    rerender(<Revealed revealKey="first">Not saved</Revealed>);
    expect(scrolled).toHaveBeenCalledTimes(1);

    rerender(<Revealed revealKey="second">Not saved</Revealed>);
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('does not take focus from the field the creator is typing in', () => {
    placeAt(-1200);
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();

    render(<Revealed>Not saved</Revealed>);
    expect(document.activeElement).toBe(field);
    field.remove();
  });
});
