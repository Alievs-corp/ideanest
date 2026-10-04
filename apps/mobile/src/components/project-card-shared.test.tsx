import { act, render, screen } from '@testing-library/react-native';
import type { Card } from '../api/queries';
import { AppIntlProvider } from '../lib/i18n';
import { setLocale } from '../lib/locale';
import { ProjectCard } from './project-card';
import { MotionBudgetProvider, SharedTransitionHost, type MotionLevel } from './ui';

/**
 * The card's half of the card → campaign page flight (#279): under a host it asks the stack for
 * the shared fade, and under Reduce Motion it pushes like any other link.
 */

let mockHref: unknown;
jest.mock('expo-router', () => ({
  Link: ({ href, children }: { href: unknown; children: unknown }) => {
    mockHref = href;
    return children;
  },
}));

const CARD = {
  id: 'c-1',
  slug: 'solar-lamp',
  creatorSlug: 'aysel',
  creator: { name: 'Aysel', slug: 'aysel' },
  title: 'Solar Lamp',
  state: 'LIVE',
  badge: 'live',
  completionPercent: '42.50',
  pledged: { amount: '1062.50', currency: 'AZN' },
  goal: { amount: '2500.00', currency: 'AZN' },
  backersCount: 12,
  daysLeft: 9,
} as Card;

async function renderCard(level: MotionLevel) {
  await act(async () => setLocale('en'));
  return render(
    <MotionBudgetProvider level={level}>
      <SharedTransitionHost>
        <AppIntlProvider>
          <ProjectCard card={CARD} />
        </AppIntlProvider>
      </SharedTransitionHost>
    </MotionBudgetProvider>,
  );
}

function params(): Record<string, string> {
  return (mockHref as { params: Record<string, string> }).params;
}

describe('ProjectCard shared transition', () => {
  it('pushes the campaign page with the shared fade', async () => {
    await renderCard('full');
    expect(params()).toEqual({ creatorSlug: 'aysel', projectSlug: 'solar-lamp', transition: 'shared' });
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('pushes plainly under Reduce Motion', async () => {
    await renderCard('none');
    expect(params()).toEqual({ creatorSlug: 'aysel', projectSlug: 'solar-lamp' });
  });
});
