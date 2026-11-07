import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProjectCard as ProjectCardData } from '../../lib/discovery/api';
import type { ProfileProjectCard } from '../../lib/profiles/api';
import { projectCardCopyFrom } from '../../lib/i18n/card-copy';
import { profileCopyFrom } from '../../lib/i18n/profile-copy';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { ProfileCampaignCard } from '../profile/ProfileCampaignCard';
import { CardViewCount, formatCompactCount } from './CardViewCount';
import { ProjectCard } from './ProjectCard';

/**
 * #634's eye chip on both campaign cards. Appearance is reviewed by eye; these cover what fails
 * silently — a chip at zero, a number in the wrong notation, a chip a screen reader cannot name,
 * and a chip that swallows the press meant for the card's link.
 */

const CARD_COPY = projectCardCopyFrom(translatorFor('discovery.card'), translatorFor('common'));
const PROFILE_COPY = profileCopyFrom(translatorFor('profile'), translatorFor('common'));

const CARD: ProjectCardData = {
  id: 'p-1',
  slug: 'a-field-recorder',
  creatorSlug: 'sound-lab',
  title: 'A field recorder',
  creator: { name: 'Sound Lab', slug: 'sound-lab' },
  image: { url: 'https://example.test/cover.jpg', width: 1600, height: 900 },
  goal: { amount: '5000.00', currency: 'AZN' },
  pledged: { amount: '2500.00', currency: 'AZN' },
  completionPercent: '50.00',
  backersCount: 12,
  daysLeft: 20,
  badge: 'live',
  state: 'LIVE',
};

const PROFILE_CARD: ProfileProjectCard = {
  id: 'p-2',
  title: 'A folding bicycle',
  slug: 'folding-bicycle',
  creatorSlug: 'aysel',
  blurb: null,
  state: 'LIVE',
  backersCount: 3,
  deadline: null,
  launchedAt: null,
  coverImage: null,
};

afterEach(cleanup);

describe('the compact figure', () => {
  it('shortens in the reader’s language', () => {
    expect(formatCompactCount(7, 'en')).toBe('7');
    // `en` is `en-GB` here (`INTL_LOCALE`), which writes the thousand in lower case.
    expect(formatCompactCount(1234, 'en')).toBe('1.2k');
    expect(formatCompactCount(25_600, 'en')).toBe('25.6k');
    expect(formatCompactCount(1234, 'ru')).toBe('1,2\u00a0тыс.');
    // Azerbaijani points with a comma (#403's bypass), so the server and every browser agree.
    expect(formatCompactCount(1234, 'az')).toBe('1,2k');
  });
});

describe('CardViewCount', () => {
  it('is drawn nowhere when nobody has looked yet, or the service did not say', () => {
    const { container, rerender } = render(<CardViewCount count={0} label={CARD_COPY.views} locale="en" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<CardViewCount count={undefined} label={CARD_COPY.views} locale="en" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<CardViewCount count={null} label={CARD_COPY.views} locale="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the exact figure, in a sentence, while showing the short one', () => {
    render(<CardViewCount count={1234} label={CARD_COPY.views} locale="en" />);

    const chip = screen.getByRole('img', { name: '1234 views' });
    expect(chip).toHaveTextContent('1.2k');
    expect(screen.getByRole('img', { name: '1234 views' })).toBe(chip);
  });

  it('says "view" for one', () => {
    render(<CardViewCount count={1} label={CARD_COPY.views} locale="en" />);
    expect(screen.getByRole('img', { name: '1 view' })).toBeInTheDocument();
  });

  /*
   * The card's link is stretched over the whole card, cover included. A chip that took the
   * pointer would be a dead spot in the middle of the target.
   */
  it('lets a press through to the card, and is white on a scrim from the tokens', () => {
    render(<CardViewCount count={42} label={CARD_COPY.views} locale="en" />);
    const chip = screen.getByRole('img', { name: '42 views' });

    expect(chip).toHaveClass('pointer-events-none', 'bg-black/60', 'text-white', 'bottom-2', 'left-2');
  });
});

describe('on the discovery card', () => {
  it('sits on the cover, inside the frame and outside the zoom', () => {
    const { container } = render(
      <ProjectCard card={{ ...CARD, viewCount: 980 }} copy={CARD_COPY} locale="en" surface="DISCOVER" />,
    );
    const chip = screen.getByRole('img', { name: '980 views' });

    expect(chip.closest('[data-media-frame]')).not.toBeNull();
    expect(chip.className).not.toContain('scale');
    expect(container.querySelector('img')?.className).toContain('group-hover:scale-105');
  });

  it('is absent at zero', () => {
    render(<ProjectCard card={{ ...CARD, viewCount: 0 }} copy={CARD_COPY} locale="en" />);
    expect(screen.queryByRole('img', { name: /views?$/ })).toBeNull();
  });

  it('marks its link with the campaign and the listing, OTHER when the caller names none', () => {
    const { rerender } = render(<ProjectCard card={CARD} copy={CARD_COPY} locale="en" surface="SEARCH" />);
    const link = screen.getByRole('link', { name: 'A field recorder' });
    expect(link).toHaveAttribute('data-audience-project', 'p-1');
    expect(link).toHaveAttribute('data-audience-surface', 'SEARCH');

    rerender(<ProjectCard card={CARD} copy={CARD_COPY} locale="en" />);
    expect(screen.getByRole('link', { name: 'A field recorder' })).toHaveAttribute('data-audience-surface', 'OTHER');
  });

  it('passes axe with the chip on it', async () => {
    const { container } = render(
      <ul>
        <li>
          <ProjectCard card={{ ...CARD, viewCount: 25_600 }} copy={CARD_COPY} locale="en" surface="HOME" />
        </li>
      </ul>,
    );
    await expectNoViolations(container);
  });
});

describe('on the profile card', () => {
  it('shows the views on either list, since a count of people is not an amount', () => {
    render(
      <ProfileCampaignCard
        card={{ ...PROFILE_CARD, viewCount: 3_400_000 }}
        funding="withheld"
        copy={PROFILE_COPY.grid.card}
        locale="en"
      />,
    );

    expect(screen.getByRole('img', { name: '3400000 views' })).toHaveTextContent('3.4m');
    expect(screen.getByRole('link', { name: 'A folding bicycle' })).toHaveAttribute(
      'data-audience-surface',
      'PROFILE',
    );
  });

  it('is absent when the service sent no count', async () => {
    const { container } = render(
      <ProfileCampaignCard card={PROFILE_CARD} funding="shown" copy={PROFILE_COPY.grid.card} locale="en" />,
    );
    expect(screen.queryByRole('img')).toBeNull();
    await expectNoViolations(container);
  });
});
