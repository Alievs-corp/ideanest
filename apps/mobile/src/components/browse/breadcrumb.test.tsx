import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { motion } from '../../theme';
import { MotionBudgetProvider } from '../ui';
import { Breadcrumb, LinkPill } from './breadcrumb';

/**
 * The trail and the link pills (#281): every step up is a link pill with the press give, the
 * current page is text and not a link, and reduced motion keeps the pills still.
 */

jest.mock('expo-router', () => ({
  // `asChild` hands the press to the child; the child is what the tests read.
  Link: ({ children }: { children: ReactNode }) => children,
}));

const CRUMBS = [
  { label: 'Categories', href: '/categories' as const },
  { label: 'Games', href: '/categories/games' as const },
  { label: 'Tabletop' },
];

describe('the breadcrumb', () => {
  it('links every step up, and leaves the current page as text', async () => {
    await render(<Breadcrumb label="Breadcrumb" crumbs={CRUMBS} />);
    const trail = screen.getByLabelText('Breadcrumb');
    expect(within(trail).getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Categories',
      'Games',
    ]);
    expect(within(trail).getByText('Tabletop')).toBeTruthy();
    expect(within(trail).queryByRole('link', { name: 'Tabletop' })).toBeNull();
  });
});

describe('a link pill', () => {
  const pill = () => screen.getByRole('link', { name: 'Tabletop' });

  it('gives under the thumb with full motion', async () => {
    await render(<LinkPill label="Tabletop" href="/categories/games/tabletop" />);
    fireEvent(pill(), 'pressIn');
    await waitFor(
      () => {
        const style = getAnimatedStyle(pill().parent as never) as {
          transform?: { scale: number }[];
        };
        expect(style.transform?.[0]?.scale).toBeCloseTo(motion.pressScale, 2);
      },
      { timeout: 3000 },
    );
  });

  it('stays still with reduced motion', async () => {
    await render(
      <MotionBudgetProvider level="none">
        <LinkPill label="Tabletop" href="/categories/games/tabletop" />
      </MotionBudgetProvider>,
    );
    fireEvent(pill(), 'pressIn');
    expect(StyleSheet.flatten(pill().parent?.props.style)?.transform).toBeUndefined();
  });
});
