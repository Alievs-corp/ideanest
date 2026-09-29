import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Chip, ChipRow, RemovableChip } from './Chip/Chip';
import { IconButton } from './IconButton/IconButton';
import { ProgressBar } from './ProgressBar/ProgressBar';
import { DotIndicator } from './DotIndicator/DotIndicator';
import { Avatar, AvatarGroup } from './Avatar/Avatar';
import { Timeline } from '../layout/Timeline';
import { RailItem, Rail } from '../layout/Rail';
import { TopBar } from '../layout/TopBar';
import { setPrefersReducedMotion } from '../test-setup';

/**
 * Appearance is reviewed in Storybook. These tests cover BEHAVIOUR and
 * ACCESSIBILITY — the things that break silently and still ship.
 */

describe('Chip', () => {
  it('announces its selected state via aria-pressed', () => {
    const { rerender } = render(<Chip active={false}>Games</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    rerender(<Chip active>Games</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('forwards clicks', async () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Art</Chip>);
    await userEvent.click(screen.getByRole('button', { name: 'Art' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a zero count rather than hiding it', () => {
    render(<Chip count={0}>Empty</Chip>);
    expect(screen.getByRole('button')).toHaveTextContent('0');
  });
});

/**
 * A row that scrolls sideways leaves a chip partly off its edge, and Chromium does not move the
 * row when Tab lands on one. The row asks for it — see `lib/reveal-focused-item.ts`.
 */
describe('ChipRow', () => {
  it('scrolls a chip fully into view when it takes focus', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(
      <ChipRow aria-label="Categories">
        <Chip>Games</Chip>
        <Chip>Art</Chip>
      </ChipRow>,
    );

    const art = screen.getByRole('button', { name: 'Art' });
    art.focus();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(art);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
    scrollIntoView.mockRestore();
  });

  it("still runs the caller's own onFocus", () => {
    const onFocus = vi.fn();
    render(
      <ChipRow aria-label="Categories" onFocus={onFocus}>
        <Chip>Games</Chip>
      </ChipRow>,
    );

    screen.getByRole('button', { name: 'Games' }).focus();

    expect(onFocus).toHaveBeenCalledOnce();
  });
});

describe('RemovableChip', () => {
  it('announces what pressing it does, not what it is about', () => {
    // A row of chips reading "Live", "Games", "Handmade" is unusable by ear:
    // every one announces as a button whose name is the thing it is about.
    render(<RemovableChip removeLabel="Remove Status filter: Live">Live</RemovableChip>);

    expect(
      screen.getByRole('button', { name: 'Remove Status filter: Live' }),
    ).toBeInTheDocument();
  });

  it('keeps the visible text inside its accessible name', () => {
    // WCAG 2.5.3: speech input reaches a control by the words printed on it, so
    // a name that does not contain them makes the chip unreachable by voice.
    render(<RemovableChip removeLabel="Remove Tag filter: Handmade">Handmade</RemovableChip>);

    const chip = screen.getByRole('button');
    expect(chip).toHaveTextContent('Handmade');
    expect(chip.getAttribute('aria-label')).toContain('Handmade');
  });

  it('is not a toggle', () => {
    // `aria-pressed` on a delete control tells a screen-reader user it is a
    // switch that is currently on.
    render(<RemovableChip removeLabel="Remove filter: Live">Live</RemovableChip>);

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
  });

  it('hides its icon from the accessibility tree', () => {
    const { container } = render(
      <RemovableChip removeLabel="Remove filter: Live">Live</RemovableChip>,
    );

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards clicks', async () => {
    const onClick = vi.fn();
    render(
      <RemovableChip removeLabel="Remove filter: Art" onClick={onClick}>
        Art
      </RemovableChip>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Art' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('IconButton', () => {
  it('gives an icon-only control an accessible name', () => {
    render(<IconButton icon={<svg />} label="Search" />);
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('exposes progressbar semantics', () => {
    render(<ProgressBar value={64} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '64');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('keeps the real figure in aria while clamping the fill to 100%', () => {
    const { container } = render(<ProgressBar value={1111} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1111');
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill.style.transform).toBe('translateX(0%)');
  });

  it('draws the fill by sliding it, not by resizing it', () => {
    const { container } = render(<ProgressBar value={64} />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill.style.transform).toBe('translateX(-36%)');
    expect(fill.style.width).toBe('');
    expect(fill.className).toContain('transition-transform');
  });

  it('does not transition at all when animation is turned off', () => {
    const { container } = render(<ProgressBar value={64} animate={false} />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill.className).not.toMatch(/transition/);
  });

  it('clamps negative values to zero', () => {
    const { container } = render(<ProgressBar value={-20} />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill.style.transform).toBe('translateX(-100%)');
  });
});

describe('DotIndicator', () => {
  it('states the percentage in words so colour is not the only signal', () => {
    render(<DotIndicator percent={87} />);
    expect(screen.getByRole('img', { name: /87 percent/ })).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('falls back to initials when no image is supplied', () => {
    render(<Avatar name="Amara Osei" />);
    expect(screen.getByRole('img', { name: 'Amara Osei' })).toHaveTextContent('AO');
  });

  it('derives a single initial from a single-word name', () => {
    render(<Avatar name="Rowan" />);
    expect(screen.getByRole('img', { name: 'Rowan' })).toHaveTextContent('R');
  });

  it('uses the name as alt text when an image is supplied', () => {
    render(<Avatar name="Rowan Hale" src="/r.jpg" />);
    expect(screen.getByRole('img', { name: 'Rowan Hale' }).tagName).toBe('IMG');
  });

  it.each([
    ['xs', 24],
    ['sm', 28],
    ['md', 40],
    ['lg', 56],
  ] as const)('reserves its square in the markup at size %s', (size, side) => {
    // The classes size it too, but attributes are what a browser has before any
    // stylesheet has arrived. Without them a row of faces reflows on load.
    render(<Avatar name="Rowan Hale" src="/r.jpg" size={size} />);
    const image = screen.getByRole('img', { name: 'Rowan Hale' });

    expect(image).toHaveAttribute('width', String(side));
    expect(image).toHaveAttribute('height', String(side));
  });

  it('reserves the default square when no size is given', () => {
    render(<Avatar name="Rowan Hale" src="/r.jpg" />);
    expect(screen.getByRole('img', { name: 'Rowan Hale' })).toHaveAttribute('width', '40');
  });

  it('collapses the overflow into a +N chip', () => {
    render(
      <AvatarGroup max={2} total={1697}>
        <Avatar name="One Person" />
        <Avatar name="Two Person" />
        <Avatar name="Three Person" />
      </AvatarGroup>,
    );
    expect(screen.getByText('+1695')).toBeInTheDocument();
  });

  /**
   * Issue 166: the spread used to widen each face's negative margin, which laid the row out
   * again on every frame and shoved whatever sat beside the group. The overlap is fixed now
   * and the spread is a transform, cumulative by position.
   */
  it('spreads on hover with a transform by position, never a margin', () => {
    const { container } = render(
      <AvatarGroup max={2} total={5}>
        <Avatar name="One Person" />
        <Avatar name="Two Person" />
        <Avatar name="Three Person" />
      </AvatarGroup>,
    );
    const group = container.firstElementChild as HTMLElement;
    const slots = Array.from(group.children) as HTMLElement[];

    expect(slots).toHaveLength(3);
    expect(group.className).not.toMatch(/margin|-ml-1/);
    slots.forEach((slot, index) => {
      expect(slot.style.getPropertyValue('--avatar-index')).toBe(String(index));
      expect(slot.className).toContain('group-hover/avatars:translate-x-[calc(var(--avatar-index)*6px)]');
      expect(slot.className).toContain('transition-transform');
      expect(slot.className).toContain('motion-reduce:transition-none');
      expect(slot.className).not.toContain('transition-[margin]');
    });
    /* The overlap itself is fixed layout: every face after the first, the chip included. */
    expect(slots[0]?.className).not.toContain('-ml-2.5');
    expect(slots[1]?.className).toContain('-ml-2.5');
    expect(slots[2]).toHaveTextContent('+3');
    expect(slots[2]?.className).toContain('-ml-2.5');
  });
});

describe('RailItem', () => {
  it('marks the active destination with aria-current', () => {
    render(
      <Rail>
        <RailItem icon={<svg />} label="Discover" active />
        <RailItem icon={<svg />} label="Settings" />
      </Rail>,
    );
    expect(screen.getByRole('button', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });
});

describe('Timeline', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-11T00:00:00Z');

  it('projects a marker onto the track as a percentage', () => {
    const { container } = render(
      <Timeline
        start={start}
        end={end}
        markers={[{ id: 'm', at: new Date('2026-01-06T00:00:00Z'), label: 'Midpoint' }]}
      />,
    );
    const marker = container.querySelector('[title="Midpoint"]') as HTMLElement;
    expect(marker.style.left).toBe('50%');
  });

  it('clamps markers that fall outside the window', () => {
    const { container } = render(
      <Timeline
        start={start}
        end={end}
        markers={[
          { id: 'before', at: new Date('2025-06-01T00:00:00Z'), label: 'Before' },
          { id: 'after', at: new Date('2027-06-01T00:00:00Z'), label: 'After' },
        ]}
      />,
    );
    expect((container.querySelector('[title="Before"]') as HTMLElement).style.left).toBe('0%');
    expect((container.querySelector('[title="After"]') as HTMLElement).style.left).toBe('100%');
  });

  it('does not divide by zero when start equals end', () => {
    const { container } = render(
      <Timeline
        start={start}
        end={start}
        markers={[{ id: 'm', at: start, label: 'Only' }]}
      />,
    );
    expect((container.querySelector('[title="Only"]') as HTMLElement).style.left).toBe('0%');
  });
});

describe('TopBar', () => {
  /**
   * The pill is a surface and two 32px gutters, and a consumer whose navigation is not drawn
   * at every width pays for both regardless: `@ideanest/web` hid its own links below `md` and
   * was left with an empty white oval holding 66px of a 390px row open, which pushed the
   * control beside it off the screen.
   */
  it('puts navClassName on the pill, so a consumer can hide it where its links are not drawn', () => {
    const { container } = render(
      <TopBar
        logo={<span>IdeaNest</span>}
        navClassName="hidden md:flex"
        nav={<a href="/discover">Discover</a>}
      />,
    );

    const pill = screen.getByRole('link', { name: 'Discover' }).parentElement as HTMLElement;
    expect(pill.className).toContain('hidden md:flex');
    /* And it is still the pill — the class is merged, not a replacement. */
    expect(pill.className).toContain('rounded-full');
    expect(container.querySelector('header')).not.toBeNull();
  });

  it('leaves the pill alone when the consumer says nothing', () => {
    render(<TopBar logo={<span>IdeaNest</span>} nav={<a href="/discover">Discover</a>} />);

    const pill = screen.getByRole('link', { name: 'Discover' }).parentElement as HTMLElement;
    expect(pill.className).not.toContain('hidden');
  });

  /*
   * Issue 166: the bar used to transition padding and max-width, laying out the page on every
   * frame of every collapse. What moves now is a surface layer's opacity and a transform on
   * the row's children that exists only while it runs.
   */
  describe('collapse motion', () => {
    const animate = vi.fn((_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({
      cancel: vi.fn(),
    }));

    /** Every element reports a box that depends on the bar's state, as layout would. */
    function stubLayout() {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        const collapsed = this.closest('header')?.hasAttribute('data-scrolled') ?? false;
        const top = collapsed ? 20 : 28;
        return new DOMRect(collapsed ? 18 : 20, top, 100, 40);
      });
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: animate,
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
      animate.mockClear();
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
      setPrefersReducedMotion(false);
    });

    function bar(scrolled: boolean) {
      return (
        <TopBar
          forceScrolled={scrolled}
          logo={<span>IdeaNest</span>}
          nav={<a href="/discover">Discover</a>}
          actions={<button type="button">Sign in</button>}
        />
      );
    }

    it('fades a surface layer in with opacity instead of animating the pill', () => {
      const { container, rerender } = render(bar(false));
      const pill = screen.getByRole('link', { name: 'Discover' }).parentElement as HTMLElement;
      const surface = container.querySelector('[data-top-bar-surface]') as HTMLElement;

      expect(surface).toHaveAttribute('aria-hidden', 'true');
      expect(surface.className).toContain('transition-opacity');
      expect(surface.className).toContain('opacity-0');
      /* The pill keeps a border in both states, so its box does not change with the surface. */
      expect(pill.className).toContain('border-transparent');
      expect(pill.className).not.toMatch(/transition-\[/);

      rerender(bar(true));
      expect(surface.className).toContain('opacity-100');
      expect(surface.className).toContain('bg-white');
      expect(pill.className).toContain('max-w-[445px]');
      expect(pill.className).toContain('text-on-white');
    });

    it('moves the row with a transform from where it was drawn to nothing', () => {
      stubLayout();
      const { container, rerender } = render(bar(false));
      rerender(bar(true));

      const row = container.querySelector('header > div') as HTMLElement;
      expect(row.className).not.toContain('transition');
      /* Logo, pill and actions: each started 2px right of and 8px below where it now sits. */
      expect(animate).toHaveBeenCalledTimes(row.children.length);
      for (const [keyframes, options] of animate.mock.calls) {
        expect(keyframes).toEqual([{ transform: 'translate(2px, 8px)' }, { transform: 'none' }]);
        expect(options).toMatchObject({ duration: 300 });
      }
      expect(animate.mock.contexts).toEqual(Array.from(row.children));
    });

    /*
     * getBoundingClientRect includes a transform that is still running. A reversal inside the
     * 300ms has to cancel the running collapse before it reads the new layout, or the offset
     * still in flight is counted twice and every child jumps by it when the reverse starts.
     */
    it('starts a reversal mid-collapse from where the children are drawn, without a jump', () => {
      /* Each element is drawn at its layout box plus whatever FLIP transform is on it. */
      const inFlight = new Map<Element, { x: number; y: number }>();
      const log: string[] = [];
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        log.push('read');
        const collapsed = this.closest('header')?.hasAttribute('data-scrolled') ?? false;
        const offset = inFlight.get(this) ?? { x: 0, y: 0 };
        return new DOMRect((collapsed ? 18 : 20) + offset.x, (collapsed ? 20 : 28) + offset.y, 100, 40);
      });
      const cancels: ReturnType<typeof vi.fn>[] = [];
      const flip = vi.fn(function (this: Element, keyframes: Keyframe[]) {
        log.push('animate');
        const from = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(keyframes[0]?.transform));
        /* Freeze the animation halfway, which is where the reader sees it when they reverse. */
        inFlight.set(this, { x: Number(from?.[1]) / 2, y: Number(from?.[2]) / 2 });
        const cancel = vi.fn(() => {
          log.push('cancel');
          inFlight.delete(this);
        });
        cancels.push(cancel);
        return { cancel };
      });
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: flip,
      });

      const { container, rerender } = render(bar(false));
      rerender(bar(true));
      const row = container.querySelector('header > div') as HTMLElement;
      expect(flip).toHaveBeenCalledTimes(row.children.length);
      expect(flip.mock.calls[0]?.[0]).toEqual([
        { transform: 'translate(2px, 8px)' },
        { transform: 'none' },
      ]);

      /* 150ms in, each child is drawn 1px right of and 4px below its collapsed box. */
      const collapse = [...cancels];
      flip.mockClear();
      log.length = 0;
      rerender(bar(false));

      /* Every collapse animation was cancelled before the reverse measured. */
      expect(collapse).toHaveLength(row.children.length);
      for (const cancel of collapse) expect(cancel).toHaveBeenCalledTimes(1);
      /*
       * Drawn at 19,24 and laid out at 20,28: the reverse starts 1px left and 4px up, exactly
       * where the reader saw each child. Without the cancel it would start at -2px, -8px.
       */
      expect(flip).toHaveBeenCalledTimes(row.children.length);
      for (const [keyframes] of flip.mock.calls) {
        expect(keyframes).toEqual([{ transform: 'translate(-1px, -4px)' }, { transform: 'none' }]);
      }
      /* The layout effect cancels, then reads every child, then starts every animation. */
      const effect = log.slice(log.indexOf('cancel'));
      expect(effect.lastIndexOf('cancel')).toBeLessThan(effect.indexOf('read'));
      expect(effect.lastIndexOf('read')).toBeLessThan(effect.indexOf('animate'));
    });

    it('draws no motion when the reader asks for less', () => {
      stubLayout();
      setPrefersReducedMotion(true);
      const { container, rerender } = render(bar(false));
      rerender(bar(true));

      expect(animate).not.toHaveBeenCalled();
      expect(container.querySelector('header')).toHaveAttribute('data-scrolled');
      expect(
        (container.querySelector('[data-top-bar-surface]') as HTMLElement).className,
      ).toContain('motion-reduce:transition-none');
    });
  });
});
