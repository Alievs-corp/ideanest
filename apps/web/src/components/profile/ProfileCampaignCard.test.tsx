import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProfileProjectCard } from '../../lib/profiles/api';
import { ProfileCampaignCard } from './ProfileCampaignCard';
import { profileCopyFrom } from '../../lib/i18n/profile-copy';
import { translatorFor } from '../../test-copy';
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const COPY = profileCopyFrom(translatorFor('profile'), translatorFor('common'));

/**
 * §4.2's P-04 and P-05, on one card — issue #274.
 *
 * WHAT THESE COVER:
 *
 *   - **the backed card prints no amounts.** This is the test the whole issue turns on. P-04
 *     is "Backed projects archive (no amounts)", and the failure it guards against is not a
 *     crash or a wrong figure — it is a correct figure printed where it should not be, which
 *     nobody notices in review because the card looks *better* with it. So the assertion is
 *     written against the rendered text: no currency, no percentage, no goal, whatever the
 *     service happened to send.
 *   - the created card does print them, because a creator's own campaign publishes its goal
 *     and its total on every other surface the platform has.
 *   - the completion figure is text as well as a bar, because a bar that only changes colour
 *     has said nothing to a screen reader (docs/ui-kit.md §8.2).
 *   - a campaign with no goal gets no progress bar rather than "0% funded", which would tell a
 *     reader it failed to raise a goal it never set.
 */

const CARD: ProfileProjectCard = {
  id: 'p1',
  title: 'A folding bicycle',
  slug: 'folding-bicycle',
  creatorSlug: 'aysel',
  blurb: 'It folds.',
  state: 'SUCCESSFUL',
  goal: { amount: '10000.00', currency: 'AZN' },
  pledged: { amount: '12500.00', currency: 'AZN' },
  backersCount: 214,
  deadline: '2026-01-01T00:00:00Z',
  launchedAt: '2025-12-01T00:00:00Z',
  coverImage: null,
};

afterEach(cleanup);

describe('a campaign on the created list', () => {
  it('shows what it raised, as a figure and not only as a bar', () => {
    render(<ProfileCampaignCard copy={COPY.grid.card} locale="en" card={CARD} funding="shown" />);

    expect(screen.getByText('12,500.00 AZN')).toBeInTheDocument();
    expect(screen.getByText('125% funded')).toBeInTheDocument();
    expect(screen.getByText('of 10,000.00 AZN goal')).toBeInTheDocument();
  });

  it('rounds 99.5% down rather than calling it funded (#255)', () => {
    const almost = { ...CARD, pledged: { amount: '9950.00', currency: 'AZN' } };
    render(<ProfileCampaignCard copy={COPY.grid.card} locale="en" card={almost} funding="shown" />);

    expect(screen.getByText('99% funded')).toBeInTheDocument();
  });

  it('links to the campaign at its public address', () => {
    render(<ProfileCampaignCard copy={COPY.grid.card} locale="en" card={CARD} funding="shown" />);

    expect(screen.getByRole('link', { name: 'A folding bicycle' })).toHaveAttribute('href', '/en/projects/aysel/folding-bicycle');
  });

  it('shows no progress at all for a campaign with no goal', () => {
    render(
      <ProfileCampaignCard
        copy={COPY.grid.card}
        locale="en"
        card={{ ...CARD, state: 'PRELAUNCH', goal: null, pledged: null }}
        funding="shown"
      />,
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/funded/u)).not.toBeInTheDocument();
  });

  it('names the state in words and not by colour alone', () => {
    render(<ProfileCampaignCard copy={COPY.grid.card} locale="en" card={CARD} funding="shown" />);

    expect(screen.getByText('Funded')).toBeInTheDocument();
  });
});

describe('a campaign on the backed list', () => {
  /*
   * The card is handed the same row, with the amounts still on it, precisely so that the
   * assertion is about this component's behaviour rather than about the service's. The service
   * does omit them; this proves the client would not print them even if it stopped.
   */
  it('prints no amount of any kind — P-04, and this is the point of the issue', () => {
    const { container } = render(<ProfileCampaignCard copy={COPY.grid.card} locale="en" card={CARD} funding="withheld" />);
    const text = container.textContent ?? '';

    expect(text).not.toContain('AZN');
    expect(text).not.toContain('12,500');
    expect(text).not.toContain('10,000');
    expect(text).not.toContain('%');
    expect(text).not.toContain('goal');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    /* "Funded" IS still on the card, and that is correct: it is §6.1's `SUCCESSFUL` state,
       which the campaign publishes about itself on every public surface. P-04 withholds
       amounts, not the fact that a campaign reached its goal. */
    expect(screen.getByText('Funded')).toBeInTheDocument();
  });

  it('still says what the campaign is, so the list is readable', () => {
    render(<ProfileCampaignCard copy={COPY.grid.card} locale="en" card={CARD} funding="withheld" />);

    expect(screen.getByRole('link', { name: 'A folding bicycle' })).toBeInTheDocument();
    expect(screen.getByText('Funded')).toBeInTheDocument();
    // A backer count is not an amount: it is published on the campaign's own page for
    // everybody, and it is not a figure about the person whose profile this is.
    expect(screen.getByText('214 backers')).toBeInTheDocument();
  });
});

describe('a campaign with a video', () => {
  const video = {
    url: 'https://example.test/clip.mp4',
    posterUrl: 'https://example.test/poster.jpg',
    width: 1280,
    height: 720,
  };

  it('is covered by the poster, with a preview that loads nothing yet', () => {
    const { container } = render(
      <ProfileCampaignCard
        copy={COPY.grid.card}
        locale="en"
        card={{ ...CARD, coverImage: { url: 'https://example.test/cover.jpg', width: 1600, height: 900 }, video }}
        funding="shown"
      />,
    );

    const src = decodeURIComponent(container.querySelector('img')?.getAttribute('src') ?? '');
    expect(src).toContain(video.posterUrl);
    expect(container.querySelector('article')).toHaveAttribute('data-card-video');
    expect(container.querySelector('video')).not.toHaveAttribute('src');
  });
});
