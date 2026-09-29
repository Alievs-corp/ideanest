import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CampaignUpdate, CampaignUpdatePage } from '../../lib/community/updates';
import { CampaignUpdates } from './CampaignUpdates';
import { resolveServerTree } from '../../test-support/server-tree';
import { expectNoViolations } from '../../test-axe';
import { translatorFor } from '../../test-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/** `campaign.updates.number`, filled the way the catalogue fills it — #142, not retyped English. */
const updateLabel = (number: number) =>
  fillPlaceholders(String(translatorFor('campaign.updates').raw('number')), { number: String(number) });

/*
 * The real catalogue, through next-intl's own formatter.
 *
 * `createTranslator` rather than a hand-rolled substitution, because these messages carry ICU
 * plurals — `{days, plural, one {# day left} other {# days left}}` — and a regex that swapped
 * `{days}` for a number would produce a sentence no language actually renders. Asserting
 * against `messages/en.json` formatted the way the application formats it is what makes this
 * suite fail when a translation is edited to something the component no longer draws.
 */
/* The route's language, switchable per test: #142's label was English in every language. */
const route = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ru' }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUES = {
    en: (await import('../../../messages/en.json')).default,
    ru: (await import('../../../messages/ru.json')).default,
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



/**
 * §4.4's Updates tab — #284.
 *
 * WHAT THESE COVER:
 *
 *   - **the number on screen is the number the service allocated.** §4.9 allocates it once,
 *     at insert, and never recomputes it, because "update 7 said the moulds were late" is a
 *     thing somebody says to support six months later. A component that numbered by position
 *     would renumber every earlier update the first time one was withheld — silently.
 *   - **a backers-only update says so in a word, not in a colour** (docs/ui-kit.md §9.2), and
 *     it is rendered rather than filtered: the service decided this caller may see it.
 *   - **"could not be loaded" and "has posted nothing" are different sentences.** Printing the
 *     second over a restarting service is a claim about the creator that happens to be false.
 *   - **the body is text, never markup.** An update body is plain text a creator typed and it
 *     reaches this component from a public endpoint.
 *   - **older updates are a link**, so the archive is reachable without JavaScript and by a
 *     crawler.
 */

function update(overrides: Partial<CampaignUpdate> = {}): CampaignUpdate {
  return {
    number: 7,
    title: 'The moulds were late',
    body: 'The factory slipped by two weeks.',
    visibility: 'PUBLIC',
    publishedAt: '2026-08-01T09:00:00Z',
    authorId: 'u1',
    ...overrides,
  };
}

function page(overrides: Partial<CampaignUpdatePage> = {}): CampaignUpdatePage {
  return { updates: [update()], nextCursor: null, ...overrides };
}

afterEach(() => {
  cleanup();
  route.locale = 'en';
});

describe('the updates tab', () => {
  it('prints the number the service allocated rather than the position in the list', async () => {
    render(
      await resolveServerTree(
        <CampaignUpdates
        page={page({ updates: [update({ number: 7 }), update({ number: 2, title: 'Two' })] })}
        olderHref={null}
        paged={false}
      />,
      ),
    );

    expect(screen.getByText(updateLabel(7))).toBeInTheDocument();
    expect(screen.getByText(updateLabel(2))).toBeInTheDocument();
    expect(screen.queryByText(updateLabel(1))).not.toBeInTheDocument();
  });

  it('labels the update in the route’s language rather than in English (#142)', async () => {
    route.locale = 'ru';
    render(
      await resolveServerTree(
        <CampaignUpdates page={page({ updates: [update({ number: 7 })] })} olderHref={null} paged={false} />,
      ),
    );

    expect(screen.getByText('Обновление 7')).toBeInTheDocument();
    expect(screen.queryByText(updateLabel(7))).not.toBeInTheDocument();
  });

  it('gives every update a heading and a machine-readable publication date', async () => {
    const { container } = render(await resolveServerTree(<CampaignUpdates page={page()} olderHref={null} paged={false} />));

    expect(
      screen.getByRole('heading', { level: 3, name: 'The moulds were late' }),
    ).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-01T09:00:00Z');
  });

  it('renders a backers-only update the service sent, and marks it in words', async () => {
    render(
      await resolveServerTree(
        <CampaignUpdates
        page={page({ updates: [update({ visibility: 'BACKERS_ONLY' })] })}
        olderHref={null}
        paged={false}
      />,
      ),
    );

    expect(screen.getByText('The moulds were late')).toBeInTheDocument();
    expect(screen.getByText('Backers only')).toBeInTheDocument();
  });

  it('renders the body as text, never as markup', async () => {
    render(
      await resolveServerTree(
        <CampaignUpdates
        page={page({ updates: [update({ body: '<img src=x onerror="alert(1)">' })] })}
        olderHref={null}
        paged={false}
      />,
      ),
    );

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });

  it('keeps an update that is only a title', async () => {
    render(
      await resolveServerTree(
        <CampaignUpdates
        page={page({ updates: [update({ body: '' })] })}
        olderHref={null}
        paged={false}
      />,
      ),
    );

    expect(screen.getByRole('heading', { level: 3, name: 'The moulds were late' })).toBeInTheDocument();
  });

  it('says the campaign has posted nothing only when the campaign has posted nothing', async () => {
    render(await resolveServerTree(<CampaignUpdates page={page({ updates: [] })} olderHref={null} paged={false} />));

    expect(screen.getByText(/has not posted an update yet/u)).toBeInTheDocument();
  });

  it('blames the service, not the creator, when the read was refused', async () => {
    render(await resolveServerTree(<CampaignUpdates page={null} olderHref={null} paged={false} />));

    expect(screen.getByText(/could not be loaded/u)).toBeInTheDocument();
    expect(screen.queryByText(/has not posted an update yet/u)).not.toBeInTheDocument();
  });

  it('says "no older updates" rather than "none at all" past the first page', async () => {
    render(await resolveServerTree(<CampaignUpdates page={page({ updates: [] })} olderHref={null} paged />));

    expect(screen.getByText('There are no older updates.')).toBeInTheDocument();
  });

  it('offers the older page as a link, so it is reachable without JavaScript', async () => {
    render(
      await resolveServerTree(
        <CampaignUpdates
        page={page({ nextCursor: 3 })}
        olderHref="/projects/ayan/coffee-table-book?tab=updates&from=3"
        paged={false}
      />,
      ),
    );

    expect(screen.getByRole('link', { name: 'Older updates' })).toHaveAttribute('href', '/en/projects/ayan/coffee-table-book?tab=updates&from=3');
  });

  /**
   * §4.9 lists C-05 — comments on an update — among the things that are not built, and the
   * comment endpoints address a campaign rather than an update. A control here would file a
   * reply about update 7 under the campaign at large, where nobody reading update 7 would
   * find it.
   */
  it('offers no comment control on an update', async () => {
    render(await resolveServerTree(<CampaignUpdates page={page()} olderHref={null} paged={false} />));

    expect(screen.queryByRole('button', { name: /comment|reply/iu })).not.toBeInTheDocument();
  });
});

describe('accessibility', () => {
  /** #129. The timeline, where every entry carries a time element and a heading. */
  it('leaves no automatically detectable violation', async () => {
    const { container } = render(
      await resolveServerTree(<CampaignUpdates page={page()} olderHref={null} paged={false} />),
    );

    await expectNoViolations(container);
  });
});
