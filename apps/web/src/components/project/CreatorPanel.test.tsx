import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { isFollowing } from '../../lib/community/signals';
import type { Session } from '../../lib/session/session';
import { useSession, type SessionState } from '../session/SessionProvider';
import type { ProjectPageResponse } from '../../lib/api/server';
import type { CampaignPage } from '../../lib/projects/publicPage';
import { readCampaignPage } from '../../lib/projects/publicPage';
import type { CreatorProject, PublicProfile } from '../../lib/projects/creatorProfile';
import { CreatorPanel } from './CreatorPanel';
import { resolveServerTree } from '../../test-support/server-tree';
import { translatorFor } from '../../test-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatDay, SERVER_TIME_ZONE, viewerTimeZone } from '../../lib/projects/deadline';

/*
 * The real catalogues, through next-intl's own formatter, in the language the test chooses.
 *
 * `createTranslator` rather than a hand-rolled substitution, because these messages carry ICU
 * arguments and rich-text tags, and a regex that swapped them would produce a sentence no
 * language actually renders. English by default; #172's test renders in Azerbaijani, which is
 * the one render the old literals could not have passed.
 */
const route = vi.hoisted(() => ({ locale: 'en' as 'en' | 'az' }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUES = {
    en: (await import('@ideanest/messages/en.json')).default,
    az: (await import('@ideanest/messages/az.json')).default,
  };

  return {
    getLocale: async () => route.locale,
    /*
     * `namespace` is a plain string here and a union of every valid path in next-intl's own
     * types. The cast is at the mock's edge rather than at each call: what a component asks
     * for is whatever it asks for, and a namespace that does not exist fails as a missing
     * message — which is the failure worth seeing.
     */
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: route.locale,
        messages: CATALOGUES[route.locale],
        namespace: namespace as never,
      }),
  };
});

/*
 * `ViewerInstant` re-renders the joining date in the browser, in the language of the route's
 * `[locale]` segment. There is no segment under jsdom, so the test's locale stands in for it —
 * otherwise an Azerbaijani render would have its date rewritten in English after the effect.
 */
vi.mock('../../lib/i18n/useRouteLocale', () => ({ useRouteLocale: () => route.locale }));

/** `campaign.creator.memberSince`, split at the date it wraps. */
function memberSince(locale: 'en' | 'az' = 'en'): { readonly before: string; readonly after: string } {
  const template = String(translatorFor('campaign.creator', locale).raw('memberSince'));
  const [before = '', after = ''] = template.split('<date></date>');
  return { before, after };
}

/** `campaign.creator.seeAll`, with the creator's name in it. */
function seeAll(name: string, locale: 'en' | 'az' = 'en'): string {
  return fillPlaceholders(String(translatorFor('campaign.creator', locale).raw('seeAll')), { name });
}

/** The joining sentence the tab drew, and the date inside it. */
function joiningLine(container: HTMLElement): { readonly line: string; readonly date: string } {
  const time = container.querySelector(`time[datetime="${JOINED_AT}"]`);
  if (time === null || time.parentElement === null) throw new Error('no joining date was drawn');
  return { line: time.parentElement.textContent ?? '', date: time.textContent ?? '' };
}



/**
 * §4.4's Creator tab — #282.
 *
 * WHAT THESE COVER:
 *
 *   - **an absent field is an omitted row, never a placeholder.** §4.4 asks for "biography,
 *     history, previous projects, contact" and the platform publishes two of the four. On a
 *     page whose subject is whether to send somebody money, "Member since —" is a statement
 *     about the creator made out of the absence of a field.
 *   - **no count is printed.** There is no campaign count on the profile — counting one inside
 *     the `user` module would give it a dependency on `project` and `pledge` — and a count
 *     taken from the length of a capped list would understate a prolific creator.
 *   - **no contact control.** §4.9's C-12 is half built and there is no endpoint that would
 *     carry a message to this creator; a contact button that opened a mail client would be
 *     the platform pretending to have a feature.
 *   - **a private or missing profile degrades to the byline and explains nothing.** The
 *     endpoint answers 404 for an unknown slug, a deleted account and a private one alike, and
 *     an interface that said "this profile is private" would rebuild the oracle that 404
 *     exists to close.
 */

function campaign(overrides: Partial<ProjectPageResponse> = {}): CampaignPage {
  const page = readCampaignPage(
    {
      id: 'p-current',
      slug: 'coffee-table-book',
      state: 'LIVE',
      title: 'A coffee table book',
      creator: { slug: 'ayan', name: 'Ayan Q', avatarUrl: null },
      pledged: { amount: '2500.00', currency: 'AZN' },
      deadline: '2026-08-29T12:00:00Z',
      ...overrides,
    } as ProjectPageResponse,
    'ayan',
    new Date('2026-08-19T12:00:00Z'),
  );
  if (page === null) throw new Error('The fixture is not a renderable campaign');
  return page;
}

const JOINED_AT = '2024-02-01T00:00:00Z';

const PROFILE: PublicProfile = {
  slug: 'ayan',
  name: 'Ayan Q',
  avatarUrl: null,
  bio: 'Photographer in Baku.',
  joinedAt: JOINED_AT,
  // §4.2 P-02 and P-03. The Creator tab renders none of the three — it links to the profile
  // for them — and they are here because #323 made this one shape rather than two.
  websiteUrl: null,
  location: null,
  socialLinks: [],
};

const OTHER: CreatorProject = {
  id: 'p-old',
  title: 'A folding bicycle',
  slug: 'a-folding-bicycle',
  creatorSlug: 'ayan',
  blurb: 'It folds.',
  state: 'SUCCESSFUL',
  goal: { amount: '10000.00', currency: 'AZN' },
  pledged: { amount: '12500.00', currency: 'AZN' },
  backersCount: 214,
  deadline: '2026-01-01T00:00:00Z',
  launchedAt: '2025-12-01T00:00:00Z',
  coverImage: null,
};

/*
 * #143 put a Follow control under the creator's name. It reads the session and
 * `GET /v1/me/following`, so both are stood in for here; `FollowControl.test.tsx` covers the
 * control itself and these cover only that the tab mounts it for the right person.
 */
vi.mock('../session/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/community/signals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/signals')>()),
  isFollowing: vi.fn(),
}));

const RETURN_TO = '/projects/ayan/coffee-table-book?tab=creator';

function sessionAs(slug: string | null): SessionState {
  const session: Session | null =
    slug === null ? null : { id: `id-${slug}`, email: `${slug}@example.com`, name: slug, slug, emailVerified: true };
  return {
    status: slug === null ? 'signed-out' : 'signed-in',
    session,
    refresh: async () => {},
    signOut: async () => {},
  };
}

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue(sessionAs('a-reader'));
  vi.mocked(isFollowing).mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  route.locale = 'en';
});

describe('the Follow control on the creator tab — #143', () => {
  it('offers a signed-in reader Follow, addressed by the campaign creator slug', async () => {
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[]} />));

    const follow = await screen.findByRole('button', { name: 'Follow Ayan Q' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    expect(vi.mocked(isFollowing)).toHaveBeenCalledWith('ayan', expect.anything());
  });

  it('is there even when the profile is private, because the campaign carries the slug', async () => {
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={null} projects={[]} />));

    expect(await screen.findByRole('button', { name: 'Follow Ayan Q' })).toBeInTheDocument();
  });

  it('sends a signed-out reader to sign in and back to this tab', async () => {
    vi.mocked(useSession).mockReturnValue(sessionAs(null));
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[]} />));

    const wall = screen.getByRole('link', { name: 'Follow Ayan Q' });
    expect(wall).toHaveAttribute('href', `/en/sign-in?next=${encodeURIComponent(RETURN_TO)}`);
  });

  it('offers the creator nothing to follow on their own campaign', async () => {
    vi.mocked(useSession).mockReturnValue(sessionAs('ayan'));
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[]} />));

    expect(screen.queryByRole('button', { name: /Follow/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Follow/u })).not.toBeInTheDocument();
    expect(vi.mocked(isFollowing)).not.toHaveBeenCalled();
  });
});

describe('the creator tab', () => {
  it('links the creator through to the profile route the profile epic owns', async () => {
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[]} />));

    expect(screen.getByRole('link', { name: /Ayan Q/u })).toHaveAttribute('href', '/en/u/ayan');
  });

  it('shows the biography and the joining date the profile published', async () => {
    const { container } = render(
      await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[]} />),
    );

    expect(screen.getByText('Photographer in Baku.')).toBeInTheDocument();
    const { before, after } = memberSince();
    const { line, date } = joiningLine(container);
    expect(line).toBe(`${before}${date}${after}`);
  });

  it('omits the biography row rather than saying the creator has not written one', async () => {
    render(
      await resolveServerTree(
        <CreatorPanel
        returnTo={RETURN_TO}
        campaign={campaign()}
        profile={{ ...PROFILE, bio: null }}
        projects={[]}
      />,
      ),
    );

    expect(screen.queryByText(/biography/iu)).not.toBeInTheDocument();
    expect(screen.queryByText('Photographer in Baku.')).not.toBeInTheDocument();
  });

  it('omits the joining date rather than printing an empty one', async () => {
    const { container } = render(
      await resolveServerTree(
        <CreatorPanel
        returnTo={RETURN_TO}
        campaign={campaign()}
        profile={{ ...PROFILE, joinedAt: null }}
        projects={[]}
      />,
      ),
    );

    expect(container.querySelector('time')).toBeNull();
    expect(container.textContent).not.toContain(memberSince().before.trim());
  });

  it('lists the creator’s other campaigns, each with its state as a word', async () => {
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[OTHER]} />));

    expect(screen.getByRole('link', { name: /A folding bicycle/u })).toHaveAttribute('href', '/en/projects/ayan/a-folding-bicycle');
    // Never a hue on its own (§9.2): "Did not fund" is exactly the fact a reader must not
    // have to infer from a colour, so every card states its outcome in text.
    expect(screen.getByText(translatorFor('campaign.state')('SUCCESSFUL'))).toBeInTheDocument();
  });

  it('calls a campaign that is collecting funded, as the header does', async () => {
    render(
      await resolveServerTree(
        <CreatorPanel
          returnTo={RETURN_TO}
          campaign={campaign()}
          profile={PROFILE}
          projects={[{ ...OTHER, state: 'COLLECTING' }]}
        />,
      ),
    );

    expect(screen.getByText(translatorFor('campaign.state')('COLLECTING'))).toBeInTheDocument();
  });

  it('omits a state it has no word for rather than printing the enum', async () => {
    const { container } = render(
      await resolveServerTree(
        <CreatorPanel
          returnTo={RETURN_TO}
          campaign={campaign()}
          profile={PROFILE}
          projects={[{ ...OTHER, state: 'SOMETHING_NEW' }]}
        />,
      ),
    );

    expect(container.textContent).not.toContain('SOMETHING_NEW');
  });

  it('links through to everything else the creator has made', async () => {
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[OTHER]} />));

    expect(screen.getByRole('link', { name: seeAll('Ayan Q') })).toHaveAttribute('href', '/en/u/ayan');
  });

  /**
   * The list is capped, so its length is not a count — and the profile publishes no count at
   * all, for a module-boundary reason that is not going to change soon.
   */
  it('prints no total number of campaigns anywhere', async () => {
    const { container } = render(
      await resolveServerTree(
        <CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[OTHER]} />,
      ),
    );

    expect(container.textContent).not.toMatch(/\d+\s+(campaigns|projects)/iu);
    expect(container.textContent).not.toMatch(/backed\s+\d+/iu);
  });

  it('offers no way to contact the creator, because there is no endpoint behind one', async () => {
    render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[OTHER]} />));

    expect(screen.queryByRole('link', { name: /contact/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /contact|message/iu })).not.toBeInTheDocument();
  });

  it('says nothing at all when the creator has no other campaigns', async () => {
    const { container } = render(
      await resolveServerTree(
        <CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[]} />,
      ),
    );

    expect(container.textContent).not.toMatch(/no previous|no other/iu);
  });

  /**
   * #172: the state words, "Member since" and the profile link were English literals in every
   * language. Azerbaijani is the render they could not have passed, and it is asserted through
   * the Azerbaijani catalogue rather than a retyped list of its words.
   */
  it('draws every word in the route’s language, not in English', async () => {
    route.locale = 'az';
    const { container } = render(
      await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={PROFILE} projects={[OTHER]} />),
    );

    expect(screen.getByText(translatorFor('campaign.state', 'az')('SUCCESSFUL'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: seeAll('Ayan Q', 'az') })).toBeInTheDocument();

    const { before, after } = memberSince('az');
    const { line, date } = joiningLine(container);
    expect(line).toBe(`${before}${date}${after}`);
    // The date itself in Azerbaijani: the server's UTC rendering, or the viewer's zone after
    // the effect — the same language either way.
    expect([
      formatDay(JOINED_AT, SERVER_TIME_ZONE, 'az'),
      formatDay(JOINED_AT, viewerTimeZone(), 'az'),
    ]).toContain(date);

    expect(container.textContent).not.toMatch(/Funded|Member since|See everything/u);
  });

  describe('when the profile cannot be read', () => {
    it('keeps the byline the campaign already carries', async () => {
      render(await resolveServerTree(<CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={null} projects={[]} />));

      // The paragraph, not the Follow control, whose accessible name carries the name too.
      expect(screen.getByText('Ayan Q', { selector: 'p' })).toBeInTheDocument();
    });

    it('offers no profile link and explains nothing, because 404 covers three cases', async () => {
      const { container } = render(
        await resolveServerTree(
          <CreatorPanel returnTo={RETURN_TO} campaign={campaign()} profile={null} projects={[]} />,
        ),
      );

      expect(screen.queryByRole('link', { name: /Ayan Q/u })).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/private|deleted|unavailable/iu);
    });
  });
});
