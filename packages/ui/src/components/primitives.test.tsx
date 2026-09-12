import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Chip, RemovableChip } from './Chip/Chip';
import { IconButton } from './IconButton/IconButton';
import { ProgressBar } from './ProgressBar/ProgressBar';
import { DotIndicator } from './DotIndicator/DotIndicator';
import { Avatar, AvatarGroup } from './Avatar/Avatar';
import { Timeline } from '../layout/Timeline';
import { RailItem, Rail } from '../layout/Rail';
import { TopBar } from '../layout/TopBar';

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
    expect(fill.style.width).toBe('100%');
  });

  it('clamps negative values to zero', () => {
    const { container } = render(<ProgressBar value={-20} />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    expect(fill.style.width).toBe('0%');
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
});
