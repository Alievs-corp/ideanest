import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProjectCard as ProjectCardData } from '../../lib/discovery/api';
import { DISCOVERY_CARD_SIZES } from '../../lib/images/sizes';
import { ProjectCard } from './ProjectCard';
import { projectCardCopyFrom } from '../../lib/i18n/card-copy';
import { translatorFor } from '../../test-copy';
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const CARD_COPY = projectCardCopyFrom(translatorFor('discovery.card'), translatorFor('common'));

/**
 * D-05's card. Appearance is reviewed in Storybook; these cover what fails
 * silently.
 *
 * The three that carry the design: the money never becomes a JavaScript number,
 * the funded state is `--success` and never lime, and every badge is a word as
 * well as a colour.
 */

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
  launchedAt: '2026-08-01T00:00:00Z',
  deadline: '2026-09-05T00:00:00Z',
};

function renderCard(overrides: Partial<ProjectCardData> = {}) {
  return render(<ProjectCard card={{ ...CARD, ...overrides }} copy={CARD_COPY} locale="en" />);
}

describe('ProjectCard', () => {
  it('carries every field D-05 asks for', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'A field recorder' })).toBeInTheDocument();
    expect(screen.getByText('Sound Lab')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('20 days left')).toBeInTheDocument();
    expect(screen.getByText('12 backers')).toBeInTheDocument();
    // The badge is a word, not only a hue. Colour alone must never carry
    // meaning (docs/ui-kit.md §9.2).
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('links to the campaign at the address the API uses', () => {
    renderCard();

    // `GET /v1/projects/{creatorSlug}/{projectSlug}` — which is why the card
    // carries `creatorSlug` at all.
    expect(screen.getByRole('link', { name: 'A field recorder' })).toHaveAttribute('href', '/en/projects/sound-lab/a-field-recorder');
  });

  it('renders money from the string the API sent, at full precision', () => {
    // The amount never goes through a JavaScript number. `999999999999.99`
    // loses its last digit the moment it does, which is the entire reason money
    // crosses the API as a string (CLAUDE.md §3).
    renderCard({
      pledged: { amount: '999999999999.99', currency: 'AZN' },
      goal: { amount: '999999999999.99', currency: 'AZN' },
      completionPercent: '100.00',
    });

    expect(screen.getByText('999,999,999,999.99 AZN')).toBeInTheDocument();
    expect(screen.getByText('of 999,999,999,999.99 AZN goal')).toBeInTheDocument();
  });

  it('reads the completion from the string rather than rounding a float', () => {
    renderCard({ completionPercent: '126.49' });

    expect(screen.getByText('126% funded')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('126 percent of the goal');
  });

  it('shows the funded bar in success, never in lime', () => {
    const { container } = renderCard({ completionPercent: '100.00' });

    const fill = container.querySelector('[role="progressbar"] > div');
    // Lime says "hurry"; success says "achieved". A backer who sees lime and
    // reads "all is well" has been told the opposite of the truth (§2.4).
    expect(fill?.className).toContain('bg-success');
    expect(fill?.className).not.toContain('bg-lime-500');
  });

  it('keeps the in-progress bar in lime', () => {
    const { container } = renderCard({ completionPercent: '50.00' });

    const fill = container.querySelector('[role="progressbar"] > div');
    expect(fill?.className).toContain('bg-lime-500');
    expect(fill?.className).not.toContain('bg-success');
  });

  it('marks a campaign closing within 48 hours as urgent, in words as well as colour', () => {
    renderCard({ daysLeft: 1, state: 'LIVE' });

    const urgent = screen.getByText('1 day left');
    // A lime SURFACE with near-black text. Lime text on a light surface
    // measures 1.3:1 and is prohibited (§9.1).
    expect(urgent.className).toContain('bg-lime-500');
    expect(urgent.className).toContain('text-on-lime');
    // And the focus ring flips on a lime fill, or it is invisible (§9.3).
    expect(urgent).toHaveAttribute('data-on-lime');
  });

  it('does not shout about a campaign that already closed', () => {
    // `daysLeft` is zero once the deadline has passed, so a campaign that ended
    // a fortnight ago reports the same number as one closing tonight.
    renderCard({ daysLeft: 0, state: 'SUCCESSFUL', badge: 'successful' });

    expect(screen.queryByText('Last day')).not.toBeInTheDocument();
    expect(screen.getByText('Successful')).toBeInTheDocument();
  });

  it('says "Last day" while a live campaign is still taking pledges', () => {
    renderCard({ daysLeft: 0, state: 'LIVE' });

    expect(screen.getByText('Last day')).toBeInTheDocument();
  });

  it('renders a campaign with no goal, no deadline, and no cover', () => {
    // `foxtrot` in the service's own fixture: the row that finds a card which
    // cannot be built without a cover image, and a completion band that treats
    // "no goal" as zero percent. A percentage of nothing is undefined, not zero.
    renderCard({
      image: null,
      goal: null,
      completionPercent: null,
      daysLeft: null,
      deadline: null,
      badge: 'upcoming',
      state: 'PRELAUNCH',
      backersCount: 0,
    });

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Not open for pledges yet')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('0 backers')).toBeInTheDocument();
  });

  it('renders a cancelled campaign without a badge rather than with a wrong one', () => {
    // §4.3 has no word for it, and inventing one would tell a reader something
    // about a withdrawn campaign that is not true.
    renderCard({ badge: null, state: 'CANCELED' });

    for (const word of ['Live', 'Upcoming', 'Successful', 'Extended', 'Closing soon']) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
  });

  /**
   * IDN-EXT-01 (#37): two labels beside the badge, and a card can carry both. Each is a word as
   * well as a hue and an icon, so colour never carries the meaning alone.
   */
  it('labels an extended campaign that is closing soon with both words', () => {
    renderCard({ state: 'EXTENDED', extended: true, closingSoon: true, daysLeft: 9 });

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Extended')).toBeInTheDocument();
    expect(screen.getByText('Closing soon')).toBeInTheDocument();
  });

  it('labels neither when the service says neither', () => {
    renderCard({ extended: false, closingSoon: false });

    expect(screen.queryByText('Extended')).not.toBeInTheDocument();
    expect(screen.queryByText('Closing soon')).not.toBeInTheDocument();
  });

  it('labels a campaign in its seven days after the deadline as closing soon without calling it extended', () => {
    renderCard({ state: 'CLOSING_WINDOW', closingSoon: true, extended: false, daysLeft: 0 });

    expect(screen.getByText('Closing soon')).toBeInTheDocument();
    expect(screen.queryByText('Extended')).not.toBeInTheDocument();
  });

  it('hides the cover from assistive technology', () => {
    // The title beside it is the name of the campaign. An alt repeating it
    // makes every card announce itself twice.
    const { container } = renderCard();

    // An empty `alt` takes the image out of the accessibility tree entirely —
    // it has no role at all, which is what `queryByRole('img')` finding nothing
    // proves.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  /*
   * The image pipeline. Every one of these fails invisibly: the page looks
   * right once the photographs have loaded, and the cost is paid on the first
   * paint of a cold connection by somebody who is not reviewing the change.
   */
  describe('the cover', () => {
    function frame(container: HTMLElement): HTMLElement {
      const found = container.querySelector<HTMLElement>('[data-media-frame]');
      if (found === null) throw new Error('the cover reserved no box at all');
      return found;
    }

    it('reserves the card’s crop before the photograph arrives', () => {
      const { container } = renderCard();

      expect(frame(container).style.aspectRatio).toBe('16 / 9');
    });

    it('reserves the same box for a campaign with no cover', () => {
      // Otherwise a feed of mixed cards settles into a different layout than the
      // one it painted, which is the shift the reservation exists to prevent.
      const { container } = renderCard({ image: null });

      expect(frame(container).style.aspectRatio).toBe('16 / 9');
      expect(container.querySelector('img')).toBeNull();
    });

    it('ignores the recorded shape, because the card crops', () => {
      // A portrait cover is still a 16:9 box here. Reserving 900×1600 would
      // give a column-tall card to a picture that is about to be cropped.
      const { container } = renderCard({
        image: { url: 'https://example.test/tall.jpg', width: 900, height: 1600 },
      });

      expect(frame(container).style.aspectRatio).toBe('16 / 9');
    });

    it('declares how wide the card really is at every breakpoint', () => {
      // Without `sizes` the browser assumes 100vw and downloads a picture
      // several times the width of the box it lands in. The string is derived
      // from this grid's own Tailwind classes in `lib/images/sizes.ts`.
      const { container } = renderCard();

      expect(container.querySelector('img')).toHaveAttribute('sizes', DISCOVERY_CARD_SIZES);
    });

    it('goes through the optimiser, with more than one candidate width', () => {
      // Format negotiation happens at the optimiser rather than in the markup,
      // so what the markup can prove is that there is a candidate ladder and
      // that it is the optimiser serving it.
      const { container } = renderCard();
      const srcset = container.querySelector('img')?.getAttribute('srcset') ?? '';

      expect(srcset).toContain('/_next/image');
      expect(srcset.split(',').length).toBeGreaterThan(1);
    });

    it('is lazy unless it is asked to lead', () => {
      const lazy = renderCard();
      expect(lazy.container.querySelector('img')).toHaveAttribute('loading', 'lazy');
      cleanup();

      const eager = render(<ProjectCard card={CARD} priority copy={CARD_COPY} locale="en" />);
      expect(eager.container.querySelector('img')).not.toHaveAttribute('loading', 'lazy');
    });

    it('serves an address the optimiser will not fetch as it is, rather than throwing', () => {
      /*
       * `next/image` raises on a URL no remote pattern matches, and a raised
       * render in a server component blanks the whole feed. One creator pasting
       * `http://` must not be able to do that to everybody else.
       */
      const { container } = renderCard({
        image: { url: 'http://insecure.test/cover.jpg', width: 1600, height: 900 },
      });

      const image = container.querySelector('img');
      expect(image).toHaveAttribute('src', 'http://insecure.test/cover.jpg');
      expect(image).not.toHaveAttribute('srcset');
    });
  });
});
