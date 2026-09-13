import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CampaignPage } from '../../lib/projects/publicPage';
import { readCampaignPage } from '../../lib/projects/publicPage';
import type { ProjectPageResponse } from '../../lib/api/server';
import { fetchSession } from '../../lib/session/session';
import { SessionProvider } from '../session/SessionProvider';
import { CampaignSummary } from './CampaignSummary';
import { CampaignOutcomeNotice } from './CampaignOutcomeNotice';
import { CampaignRewards } from './CampaignRewards';
import CATALOGUE from '../../../messages/en.json';
import { resolveServerTree } from '../../test-support/server-tree';
import { expectNoViolations } from '../../test-axe';

/*
 * The real catalogue, through next-intl's own formatter.
 *
 * `createTranslator` rather than a hand-rolled substitution, because these messages carry ICU
 * plurals — `{days, plural, one {# day left} other {# days left}}` — and a regex that swapped
 * `{days}` for a number would produce a sentence no language actually renders. Asserting
 * against `messages/en.json` formatted the way the application formats it is what makes this
 * suite fail when a translation is edited to something the component no longer draws.
 */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');

  return {
    getLocale: async () => 'en',
    /*
     * `namespace` is a plain string here and a union of every valid path in next-intl's own
     * types. The cast is at the mock's edge rather than at each call: what a component asks
     * for is whatever it asks for, and a namespace that does not exist fails as a missing
     * message — which is the failure worth seeing.
     */
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: 'en',
        messages: CATALOGUE,
        namespace: namespace as never,
      }),
  };
});

/**
 * What a campaign page says about a campaign, and what it must never say.
 *
 * These are rendered rather than screenshotted because every one of them is a statement
 * about money or urgency that a picture cannot check:
 *
 *   - the funding figures are in the markup, which is the whole of #119;
 *   - "funded" is `--success` and lime is only ever a countdown (ui-kit §2.4);
 *   - a closed campaign shows what it raised at the deadline beside what has been
 *     collected since — #63's rule, and the one number a backer would misread;
 *   - a sold-out tier is shown and says so in words, never merely greyed (PL-01, §9.2).
 *
 * THE HEADER NEEDS A SESSION PROVIDER SINCE #281, because `CampaignActions` reads one. The
 * session is stubbed rather than the component mocked away: the save and share controls are
 * part of what §4.4 asks this header for, and a test that rendered the header without them
 * would stop noticing the day they disappeared.
 */

vi.mock('../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/projects/ayan/coffee-table-book',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

const sessionMock = vi.mocked(fetchSession);

const PATH = '/projects/ayan/coffee-table-book';

/** The header, with the session provider it needs and the clock a countdown is measured on. */
async function renderSummary(page: CampaignPage) {
  /*
   * `resolveServerTree` awaits the async server components before a client-side renderer
   * sees them — it would otherwise draw them as nothing at all, which reads as the component
   * being broken rather than as the renderer being unable to await it.
   */
  return render(
    await resolveServerTree(
      <SessionProvider>
      <CampaignSummary campaign={page} path={PATH} now={NOW} />
    </SessionProvider>,
    ),
  );
}

const NOW = new Date('2026-08-19T12:00:00Z');

/**
 * What the tier list needs beyond the tiers themselves, since it grew a control per tier.
 *
 * `now` is passed for the reason `CampaignSummaryProps.now` is: the list asks whether the
 * campaign is still open, and a suite that let it read the wall clock would start failing on
 * the deadline in the fixture rather than on anything a developer changed.
 */
const TIERS = [
  {
    id: 'tier-1',
    title: 'Early bird',
    description: 'The book, signed.',
    price: { amount: '45.00', currency: 'AZN' },
    remainingQuantity: 0,
    imageUrl: null,
  },
  {
    id: 'tier-2',
    title: 'Standard',
    description: null,
    price: { amount: '60.00', currency: 'AZN' },
    remainingQuantity: null,
    imageUrl: null,
  },
] as const;

const REWARD_CONTEXT = {
  projectId: '0193f2a1-0000-7000-8000-000000000001',
  state: 'LIVE',
  deadline: '2026-08-29T12:00:00Z',
  now: NOW,
} as const;

function campaign(overrides: Partial<ProjectPageResponse> = {}): CampaignPage {
  const page = readCampaignPage(
    {
      id: '0193f2a1-0000-7000-8000-000000000001',
      slug: 'coffee-table-book',
      state: 'LIVE',
      title: 'A coffee table book',
      blurb: 'Two hundred photographs of Baku.',
      creator: { slug: 'ayan', name: 'Ayan Q', avatarUrl: null },
      category: { slug: 'design', name: 'Design' },
      coverImage: null,
      goal: { amount: '10000.00', currency: 'AZN' },
      pledged: { amount: '12500.00', currency: 'AZN' },
      backersCount: 42,
      deadline: '2026-08-29T12:00:00Z',
      ...overrides,
    } as ProjectPageResponse,
    'ayan',
    NOW,
  );
  if (page === null) throw new Error('The fixture is not a renderable campaign');
  return page;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(null);
});

afterEach(cleanup);

describe('the campaign summary', () => {
  it('puts the campaign in the markup rather than in a request', async () => {
    await renderSummary(campaign());

    expect(screen.getByRole('heading', { level: 1, name: 'A coffee table book' })).toBeInTheDocument();
    expect(screen.getByText('Two hundred photographs of Baku.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ayan Q' })).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  /**
   * Text as well as a bar (ui-kit §8.2). A bar that only changes colour at 100% has said
   * nothing to a reader with a colour-vision deficiency and nothing at all to a screen
   * reader, so the figure is printed and the bar carries an accessible name.
   */
  it('states the completion as words as well as a bar', async () => {
    await renderSummary(campaign());

    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByText('funded')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAccessibleName(
      'Funding: 125 percent of the goal',
    );
  });

  /**
   * Lime is urgency and only urgency. A campaign at 125% has funded, and funding is
   * `--success`; a lime badge here would tell a backer to hurry about something that is
   * finished.
   */
  it('does not put a lime countdown on a campaign with ten days left', async () => {
    const { container } = await renderSummary(campaign());

    // The days remaining are still stated in prose beside the goal — that is information.
    // What must not be there is the lime surface, which is the word "hurry".
    expect(screen.getByText(/10 days left/)).toBeInTheDocument();
    expect(container.querySelector('[data-on-lime]')).toBeNull();
  });

  it('puts a lime countdown on a campaign closing within 48 hours', async () => {
    const { container } = await renderSummary(campaign({ deadline: '2026-08-20T18:00:00Z' }));

    const urgent = container.querySelector('[data-on-lime]');
    expect(urgent).not.toBeNull();
    expect(urgent).toHaveTextContent('1 day left');
    // A lime SURFACE with near-black text. Lime text on a light surface measures 1.3:1 and
    // is prohibited outright (ui-kit §9.1), so the class pair is the assertion.
    expect(urgent).toHaveClass('bg-lime-500', 'text-on-lime');
  });

  /**
   * `daysLeft` is floored at zero, so a campaign that closed a fortnight ago reports the
   * same number as one closing tonight. "Last day" on the former is a lie.
   */
  it('does not count down a campaign that has already closed', async () => {
    await renderSummary(campaign({ state: 'SUCCESSFUL', deadline: '2026-08-01T00:00:00Z' }));

    expect(screen.queryByText('Last day')).not.toBeInTheDocument();
    expect(screen.getByText('Funded')).toBeInTheDocument();
  });

  it('renders a pre-launch campaign that has no goal, without inventing a percentage', async () => {
    await renderSummary(campaign({ state: 'PRELAUNCH', goal: undefined, deadline: undefined }));



    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('the outcome notice', () => {
  const closed = campaign({
    state: 'SUCCESSFUL',
    deadline: '2026-08-18T00:00:00Z',
    pledged: { amount: '9568.00', currency: 'AZN' },
    outcome: {
      goal: { amount: '10000.00', currency: 'AZN' },
      pledged: { amount: '12500.00', currency: 'AZN' },
      backersCount: 80,
      finalisedAt: '2026-08-18T00:00:00Z',
    },
  } as Partial<ProjectPageResponse>);

  /**
   * #63's sentence, on the surface that reports it. The live total has fallen below the
   * goal because collections failed; the campaign still funded, and both numbers are on the
   * page because conflating them is how somebody concludes their pledge vanished.
   */
  it('shows what the campaign raised at the deadline, not what has been collected since', async () => {
    render(await resolveServerTree(<CampaignOutcomeNotice campaign={closed} />));

    expect(screen.getByRole('heading', { name: /was funded/ })).toBeInTheDocument();
    expect(screen.getByText(/12,?500/)).toBeInTheDocument();
    expect(screen.getByText(/80 backers/)).toBeInTheDocument();
  });

  it('tells the backers of a failed campaign that nobody was charged', async () => {
    render(
      await resolveServerTree(
        <CampaignOutcomeNotice
        campaign={campaign({
          state: 'UNSUCCESSFUL',
          deadline: '2026-08-18T00:00:00Z',
          pledged: { amount: '400.00', currency: 'AZN' },
          outcome: {
            goal: { amount: '10000.00', currency: 'AZN' },
            pledged: { amount: '400.00', currency: 'AZN' },
            backersCount: 3,
            finalisedAt: '2026-08-18T00:00:00Z',
          },
        } as Partial<ProjectPageResponse>)}
      />,
      ),
    );

    expect(screen.getByRole('heading', { name: /did not reach its goal/ })).toBeInTheDocument();
    expect(screen.getByText(/Nobody was charged/)).toBeInTheDocument();
  });

  it('renders nothing while the campaign is still running', async () => {
    const { container } = render(await resolveServerTree(<CampaignOutcomeNotice campaign={campaign()} />));

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the reward tiers', () => {
  /** PL-01: a sold-out tier stays on the page, and says so in words. */
  it('shows a sold-out tier rather than hiding it', async () => {
    render(
      await resolveServerTree(
        <CampaignRewards
        {...REWARD_CONTEXT}
        tiers={[
          {
            id: 'tier-1',
            title: 'Early bird',
            description: 'The book, signed.',
            price: { amount: '45.00', currency: 'AZN' },
            remainingQuantity: 0,
            imageUrl: null,
          },
          {
            id: 'tier-2',
            title: 'Standard',
            description: null,
            price: { amount: '60.00', currency: 'AZN' },
            remainingQuantity: null,
            imageUrl: null,
          },
        ]}
      />,
      ),
    );

    expect(screen.getByRole('heading', { name: 'Early bird' })).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    // An unlimited tier says nothing about how many are left, because there is no number.
    expect(screen.queryByText(/places? left/)).not.toBeInTheDocument();
  });

  it('renders nothing when a campaign offers no tiers', async () => {
    const { container } = render(await resolveServerTree(<CampaignRewards {...REWARD_CONTEXT} tiers={[]} />));

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The half of the pledge flow this page owns. `/projects/{id}/back` has been complete since
   * #54 and had nothing linking to it, so the tier a backer had just read was a dead end.
   */
  it('sends an available tier to the checkout, naming the tier in the link', async () => {
    render(await resolveServerTree(<CampaignRewards {...REWARD_CONTEXT} tiers={TIERS} />));

    const control = screen.getByRole('link', { name: 'Select this reward: Standard' });

    expect(control).toHaveAttribute(
      'href',
      expect.stringContaining(`/projects/${REWARD_CONTEXT.projectId}/back?reward=tier-2`),
    );
    /* WCAG 2.5.3: speech input reaches the control by the words printed on it. */
    expect(control).toHaveTextContent('Select this reward');
  });

  /**
   * PL-01 again, from the other side. The tier is still on the page and still says it has run
   * out; what it does not have is a control that exists only to be refused with
   * `REWARD_SOLD_OUT` once a reservation is attempted.
   */
  it('offers no control on a sold-out tier', async () => {
    render(await resolveServerTree(<CampaignRewards {...REWARD_CONTEXT} tiers={TIERS} />));

    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Select this reward: Early bird' }),
    ).not.toBeInTheDocument();
  });

  it('offers no control at all once the campaign has closed', async () => {
    render(
      await resolveServerTree(
        <CampaignRewards {...REWARD_CONTEXT} state="SUCCESSFUL" tiers={TIERS} />,
      ),
    );

    /* The tiers are still printed — a funded campaign still says what it offered. */
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

/**
 * §4.4's call to action, which is the whole of what a campaign page is for.
 *
 * Asserted by accessible name rather than by class, because what matters is that a backer —
 * and a crawler, and a reader with no JavaScript — is offered a real link to §4.5 in the
 * initial HTML. Its absence is the defect this suite exists to keep out: every part of the
 * checkout passed its own tests while nothing in the application linked to it.
 */
describe('backing the campaign', () => {
  it('offers the pledge flow on a live campaign', async () => {
    await renderSummary(campaign());

    const cta = screen.getByRole('link', { name: 'Back this campaign' });

    expect(cta).toHaveAttribute(
      'href',
      expect.stringContaining('/projects/0193f2a1-0000-7000-8000-000000000001/back'),
    );
  });

  /**
   * IDN-EXT-01 (#36): the seven days after the first deadline and an extension are the same
   * funding as the campaign, and are offered in the same words — even though the first deadline
   * has passed. Late pledges are switched off, so a LATE_PLEDGE campaign is offered nothing.
   */
  it.each(['CLOSING_WINDOW', 'EXTENDED'] as const)(
    'offers backing to a %s campaign past its first deadline',
    async (state) => {
      await renderSummary(campaign({ state, deadline: '2026-08-15T12:00:00Z' }));

      expect(screen.getByRole('link', { name: 'Back this campaign' })).toBeInTheDocument();
    },
  );

  it('offers nothing on a campaign left in LATE_PLEDGE', async () => {
    await renderSummary(campaign({ state: 'LATE_PLEDGE' }));

    expect(screen.queryByRole('link', { name: /back this campaign|late pledge/iu })).toBeNull();
  });

  it('offers nothing on a campaign that has finished', async () => {
    await renderSummary(campaign({ state: 'SUCCESSFUL' }));

    expect(screen.queryByRole('link', { name: /back this campaign|late pledge/iu })).toBeNull();
  });

  /**
   * §8.4's finalizer runs every minute, so for up to a minute a campaign whose window closed
   * is still LIVE in the table. `PledgeAcceptance` refuses a pledge in that minute; offering
   * the control would send a backer to a checkout that cannot take it.
   */
  it('offers nothing in the minute after a live campaign closes', async () => {
    await renderSummary(campaign({ deadline: '2026-08-19T11:59:00Z' }));

    expect(screen.queryByRole('link', { name: 'Back this campaign' })).toBeNull();
  });
});

describe('accessibility', () => {
  /**
   * #129. The panel a backer reads immediately before pressing the pledge button: the title,
   * the progress figures, the countdown and the call to action. `src/test-axe.ts` says what an
   * automated pass catches; what it cannot check is that the progress bar's number is
   * announced rather than only drawn, which is asserted above by name.
   */
  it('leaves no automatically detectable violation on the summary, live or closed', async () => {
    for (const page of [campaign(), campaign({ state: 'SUCCESSFUL' })]) {
      const { container } = await renderSummary(page);
      await expectNoViolations(container);
      cleanup();
    }
  });

  it('leaves none on the reward tiers, sold out or not', async () => {
    const { container } = render(
      await resolveServerTree(
        <CampaignRewards
          {...REWARD_CONTEXT}
          tiers={[
            {
              id: 'tier-1',
              title: 'Early bird',
              description: 'The book, signed.',
              price: { amount: '45.00', currency: 'AZN' },
              remainingQuantity: 0,
              imageUrl: null,
            },
            {
              id: 'tier-2',
              title: 'Standard',
              description: null,
              price: { amount: '60.00', currency: 'AZN' },
              remainingQuantity: null,
              imageUrl: null,
            },
          ]}
        />,
      ),
    );

    await expectNoViolations(container);
  });
});
