import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';

import { Modal } from './overlay/Modal';
import { Drawer } from './overlay/Drawer';
import { Popover } from './overlay/Popover';
import { Tooltip } from './overlay/Tooltip';
import { ToastProvider, useToast } from './overlay/Toast';
import { resolvePlacement, type Rect } from './overlay/placement';

/**
 * Appearance is reviewed in Storybook. These tests cover the parts of an
 * overlay that fail silently and still ship: roles, accessible names, where
 * focus goes, what Escape closes, and whether the page is left usable
 * afterwards.
 */

function backdrop(): HTMLElement {
  const element = document.querySelector('[data-overlay-backdrop]');
  if (!(element instanceof HTMLElement)) throw new Error('no backdrop rendered');
  return element;
}

/** A modal driven by a real trigger, so focus restoration can be observed. */
function ModalHarness({ closeOnBackdropClick = true }: { closeOnBackdropClick?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Confirm your pledge"
        closeOnBackdropClick={closeOnBackdropClick}
        footer={<button type="button">Confirm</button>}
      >
        <input aria-label="Amount" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('exposes dialog semantics and takes its accessible name from the title', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = screen.getByRole('dialog', { name: 'Confirm your pledge' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  /**
   * The panel is white, and what sits in it reads that from `data-on-white`: a primary pill
   * inverts rather than vanishing, and the focus ring turns near-black (issue 232).
   */
  it('marks its panel as a white surface', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('dialog')).toHaveAttribute('data-on-white');
  });

  it('moves focus into the dialog on open and back to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last tabbable element back to the first', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const close = screen.getByRole('button', { name: 'Close' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(document.activeElement).toBe(close);

    confirm.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="Confirm your pledge">
        body
      </Modal>,
    );

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves Escape to the topmost overlay when two are stacked', async () => {
    const user = userEvent.setup();
    const onOuter = vi.fn();
    const onInner = vi.fn();

    render(
      <>
        <Modal open onOpenChange={onOuter} title="Outer" />
        <Modal open onOpenChange={onInner} title="Inner" />
      </>,
    );

    await user.keyboard('{Escape}');
    expect(onInner).toHaveBeenCalledWith(false);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await user.click(backdrop());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not close when a drag starts inside and ends on the backdrop', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    // Selecting text inside the dialog and releasing outside it produces a
    // click whose target is the backdrop. That is not a dismissal.
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(backdrop());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The very next press, this time starting on the backdrop, does dismiss.
    await user.click(backdrop());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('honours closeOnBackdropClick={false}', async () => {
    const user = userEvent.setup();
    render(<ModalHarness closeOnBackdropClick={false} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await user.click(backdrop());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('locks body scroll and restores the original value exactly', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'scroll';

    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('scroll');

    document.body.style.overflow = '';
  });
});

describe('Drawer', () => {
  it('keeps dialog semantics and records the side it is anchored to', () => {
    render(
      <Drawer open onOpenChange={() => {}} side="left" title="Categories">
        body
      </Drawer>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Categories' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-side', 'left');
    expect(dialog.className).toContain('left-0');
  });

  it('anchors to the bottom edge when asked', () => {
    render(<Drawer open onOpenChange={() => {}} side="bottom" title="Sort" />);
    const dialog = screen.getByRole('dialog', { name: 'Sort' });
    expect(dialog).toHaveAttribute('data-side', 'bottom');
    expect(dialog.className).toContain('bottom-0');
  });
});

describe('Popover', () => {
  function PopoverHarness() {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" ref={anchorRef} onClick={() => setOpen(true)}>
          Fees
        </button>
        <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} label="Fee breakdown">
          <button type="button">Learn more</button>
        </Popover>
      </>
    );
  }

  it('moves focus into the panel without trapping the page', async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    await user.click(screen.getByRole('button', { name: 'Fees' }));

    expect(screen.getByRole('dialog', { name: 'Fee breakdown' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Learn more' }));
    // Non-modal: no scroll lock, the page behind stays usable.
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('returns focus to the anchor on close', async () => {
    const user = userEvent.setup();
    render(<PopoverHarness />);
    const anchor = screen.getByRole('button', { name: 'Fees' });

    await user.click(anchor);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(anchor);
  });
});

describe('placement helper', () => {
  const panel: Rect = { top: 0, left: 0, width: 200, height: 120 };
  const viewport = { width: 1000, height: 800 };

  it('uses the requested side when it fits', () => {
    const anchor: Rect = { top: 300, left: 400, width: 100, height: 40 };
    const position = resolvePlacement(anchor, panel, viewport, 'bottom');

    expect(position.placement).toBe('bottom');
    expect(position.top).toBe(348); // 300 + 40 + 8 gap
    expect(position.left).toBe(350); // centred on the anchor
  });

  it('flips to the opposite side when there is no room', () => {
    const anchor: Rect = { top: 740, left: 400, width: 100, height: 40 };
    const position = resolvePlacement(anchor, panel, viewport, 'bottom');

    expect(position.placement).toBe('top');
    expect(position.top).toBe(612); // 740 - 8 gap - 120 height
  });

  it('flips a horizontal placement too', () => {
    const anchor: Rect = { top: 300, left: 20, width: 100, height: 40 };
    const position = resolvePlacement(anchor, panel, viewport, 'left');

    expect(position.placement).toBe('right');
    expect(position.left).toBe(128); // 20 + 100 + 8 gap
  });

  it('keeps the requested side when neither fits, rather than guessing', () => {
    const tall: Rect = { top: 0, left: 0, width: 200, height: 700 };
    const anchor: Rect = { top: 400, left: 400, width: 100, height: 40 };
    const position = resolvePlacement(anchor, tall, viewport, 'bottom');

    expect(position.placement).toBe('bottom');
  });

  it('clamps the cross axis inside the viewport', () => {
    const anchor: Rect = { top: 300, left: 980, width: 20, height: 40 };
    const position = resolvePlacement(anchor, panel, viewport, 'bottom');

    expect(position.left).toBe(792); // 1000 - 200 width - 8 margin
  });
});

describe('Tooltip', () => {
  it('opens on focus, not only on hover, and describes its trigger', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Copy the campaign link">
        <button type="button">Share</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Share' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    expect(document.activeElement).toBe(trigger);

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Copy the campaign link');
    // describedby, not label: the trigger keeps its own name.
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Copy the campaign link">
        <button type="button">Share</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on hover as well', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Copy the campaign link">
        <button type="button">Share</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.unhover(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Toast', () => {
  function ToastHarness() {
    const { toast } = useToast();
    return (
      <>
        <button type="button" onClick={() => toast({ title: 'Draft saved' })}>
          Save
        </button>
        <button
          type="button"
          onClick={() => toast({ variant: 'error', title: 'Payment declined' })}
        >
          Pay
        </button>
        <button
          type="button"
          onClick={() =>
            toast({ title: 'Reward removed', action: { label: 'Undo', onClick: () => undefined } })
          }
        >
          Remove
        </button>
      </>
    );
  }

  function renderToasts() {
    return render(
      <ToastProvider duration={5000}>
        <ToastHarness />
      </ToastProvider>,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * `fireEvent`, not `userEvent`, in this block: user-event schedules its own
   * work on real timers, and pairing it with a faked clock makes the suite
   * hang rather than fail. The timer behaviour is the thing under test here,
   * so the clock wins.
   */
  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('announces ordinary messages politely and errors assertively', () => {
    renderToasts();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

    expect(within(screen.getByRole('status')).getByText('Draft saved')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByText('Payment declined')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('never takes focus away from what the user was doing', () => {
    renderToasts();

    const trigger = screen.getByRole('button', { name: 'Save' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByText('Draft saved')).toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('auto-dismisses after its delay', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    advance(4999);
    expect(screen.getByText('Draft saved')).toBeInTheDocument();

    advance(2);
    expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
  });

  it('pauses the timer while the pointer is over it', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const toast = screen.getByText('Draft saved');
    fireEvent.pointerOver(toast);
    advance(20000);
    expect(screen.getByText('Draft saved')).toBeInTheDocument();

    fireEvent.pointerOut(toast);
    advance(5001);
    expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
  });

  it('does not auto-dismiss a toast that carries an action', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    advance(60000);
    expect(screen.getByText('Reward removed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('can be dismissed by its own control', () => {
    renderToasts();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
  });
});
