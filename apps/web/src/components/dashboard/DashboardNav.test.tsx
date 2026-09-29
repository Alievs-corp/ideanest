import { render, screen, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import type { DashboardNavCopy } from '../../lib/i18n/dashboard-copy';
import { DashboardNav } from './DashboardNav';

/**
 * The creator dashboard's tab row — issue #136.
 *
 * Five labels are wider than a phone in every language (Russian is about 470px against the
 * 280px a 320px screen leaves inside the page gutter), and the row used to neither wrap nor
 * scroll. What these pin down is the pattern the account and admin navigation already use:
 * one row that scrolls on its own axis, no label that breaks, a focus ring the scroll
 * container cannot clip, and the current tab scrolled into view when the panel loads.
 *
 * jsdom lays nothing out, so the geometry the last group needs is stubbed: the row is 280px
 * wide and each tab 120px, which is the shape of the real problem at 320px.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  // Spread first: `i18n/navigation.ts` reads other exports of this module at import time.
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname,
}));

const PROJECT = 'p-136';
const BASE = `/projects/${PROJECT}/dashboard`;
let pathname = BASE;

/** The real catalogues, so a label hard-coded in English fails in the other three. */
const COPY: Record<Locale, DashboardNavCopy> = {
  az: az.dashboard.nav,
  en: en.dashboard.nav,
  ru: ru.dashboard.nav,
  tr: tr.dashboard.nav,
};

function labelsOf(copy: DashboardNavCopy): readonly string[] {
  return [copy.overview, copy.charts, copy.backers, copy.finance, copy.surveys];
}

const ROW_WIDTH = 280;
const TAB_WIDTH = 120;

/** Lay the row out as a 320px phone would: five 120px tabs in a 280px scroll container. */
function stubPhoneGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'UL') return new DOMRect(0, 0, ROW_WIDTH, 44);
    const tabs = Array.from(document.querySelectorAll('nav a'));
    const index = tabs.indexOf(this);
    return index >= 0 ? new DOMRect(index * TAB_WIDTH, 0, TAB_WIDTH, 44) : new DOMRect();
  });
}

beforeEach(() => {
  pathname = BASE;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardNav', () => {
  it.each(SUPPORTED_LOCALES)('keeps every tab on one scrollable row in %s', (locale) => {
    const copy = COPY[locale];
    render(<DashboardNav projectId={PROJECT} copy={copy} />);

    const nav = screen.getByRole('navigation', { name: copy.label });
    const row = nav.querySelector('ul') as HTMLElement;
    expect(row).toHaveClass('overflow-x-auto');
    expect(row.className).not.toContain('flex-wrap');

    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(labelsOf(copy));
    for (const link of links) {
      // A label that broke onto two lines would make one tab taller than the rest.
      expect(link).toHaveClass('whitespace-nowrap');
      // And an item that shrank would squeeze its label rather than let the row scroll.
      expect(link.closest('li')).toHaveClass('shrink-0');
    }
  });

  /**
   * A scroll container clips whatever overflows it, and the ring is drawn four pixels outside
   * the tab (2px wide, 2px off — `theme.css`'s unlayered `:focus-visible` rule, which no
   * offset utility on the link can override). The row pads itself by exactly that on every
   * side and gives it back with a negative margin, as `AccountNav` does.
   */
  it('draws a focus ring on every tab that the scrolling row leaves room for', () => {
    render(<DashboardNav projectId={PROJECT} copy={COPY.en} />);

    const row = screen.getByRole('navigation').querySelector('ul') as HTMLElement;
    expect(row).toHaveClass('p-1');
    expect(row).toHaveClass('-m-1');
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('focus-visible:outline-2');
      expect(link).toHaveClass('focus-visible:outline-offset-2');
      expect(link).toHaveClass('focus-visible:outline-[var(--lime-500)]');
    }
  });

  it('scrolls the row, and only the row, to bring the current tab into view on load', () => {
    stubPhoneGeometry();
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    pathname = `${BASE}/surveys`;

    render(<DashboardNav projectId={PROJECT} copy={COPY.ru} />);

    const current = screen.getByRole('link', { name: ru.dashboard.nav.surveys });
    expect(current).toHaveAttribute('aria-current', 'page');

    // Surveys is the fifth tab, 480px to 600px: centred in a 280px row is a scroll of 400px.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.contexts[0]).toBe(current.closest('ul'));
    expect(scrollTo).toHaveBeenCalledWith({ left: 400, behavior: 'auto' });
    // The page does not move: scrollIntoView would scroll the window to align the row too.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /*
   * Scrolled before the first paint, not a frame after it. Layout effects all run, in tree
   * order, before the browser paints and before any passive effect, so a layout effect placed
   * after the nav sees the scroll already made only if the nav's own was a layout effect too.
   */
  it('scrolls the row before the browser paints it, so it does not jump after load', () => {
    stubPhoneGeometry();
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    pathname = `${BASE}/surveys`;
    let scrolledBeforePaint: number | null = null;
    function BeforePaint() {
      useLayoutEffect(() => {
        scrolledBeforePaint = scrollTo.mock.calls.length;
      }, []);
      return null;
    }

    render(
      <>
        <DashboardNav projectId={PROJECT} copy={COPY.en} />
        <BeforePaint />
      </>,
    );

    expect(scrolledBeforePaint).toBe(1);
  });

  it('renders on the server without complaint', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pathname = `${BASE}/surveys`;

    expect(renderToString(<DashboardNav projectId={PROJECT} copy={COPY.en} />)).toContain(
      'aria-current="page"',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('leaves the row where it is when the current tab is already visible', () => {
    stubPhoneGeometry();
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    pathname = BASE;

    render(<DashboardNav projectId={PROJECT} copy={COPY.az} />);

    expect(screen.getByRole('link', { name: az.dashboard.nav.overview })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  /**
   * #181. The load-time reveal above covers the current tab; this covers the others. Tab onto
   * one that is half off the row's edge and the row brings it fully into view, which Chromium
   * does not do by itself.
   */
  it('scrolls a tab fully into view when it takes focus', () => {
    render(<DashboardNav projectId={PROJECT} copy={COPY.en} />);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    const finance = screen.getByRole('link', { name: en.dashboard.nav.finance });
    finance.focus();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(finance);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    });
  });
});
