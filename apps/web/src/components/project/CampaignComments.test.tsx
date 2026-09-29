import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CampaignComment,
  CampaignCommentPage,
  CampaignCommentThread,
} from '../../lib/community/comments';
import { deleteComment, postComment, replyToComment } from '../../lib/community/comments';
import { fetchSession, type Session } from '../../lib/session/session';
import { SessionProvider } from '../session/SessionProvider';
import { CampaignComments } from './CampaignComments';
import CATALOGUE from '../../../messages/en.json';
import { resolveServerTree } from '../../test-support/server-tree';
import { expectNoViolations } from '../../test-axe';
import { ApiError } from '../../lib/api/problem';
import { commentCopyFrom } from '../../lib/i18n/campaign-copy';
import { pluralise } from '../../lib/i18n/plurals';
import { translatorFor } from '../../test-copy';
import ru from '../../../messages/ru.json';
import { messageFor } from './CommentComposer';

/** The words the two comment controls draw, built the way the page builds them (#142). */
const COPY = commentCopyFrom(translatorFor('campaign.comments'));

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
 * §4.4's Comments tab — #285, over §4.9's C-01, C-02, C-03 and C-07.
 *
 * WHAT THESE COVER:
 *
 *   - **a withdrawn comment is a tombstone in place, and names nobody.** §4.9 keeps the row so
 *     replies are not orphaned and so a moderator holding a report can still read what it
 *     said, and refuses to print "removed" beside a name because that is an accusation
 *     published to everybody on the campaign page.
 *   - **the creator highlight is a word, not a tint** (docs/ui-kit.md §9.2). "This answer is
 *     from the person asking for the money" is exactly the meaning that must not depend on
 *     being able to see a border.
 *   - **the reply control follows `acceptsReplies`**, which §4.9 puts on every row precisely
 *     so a client places it rather than discovering the two-level bound by being refused.
 *   - **withdrawal is offered to the author and to nobody else**, and it says what it actually
 *     does — the row survives and cannot be edited or restored.
 *   - **a signed-out reader gets a sign-in that returns here, never a box that collects a
 *     paragraph and loses it at the last step.**
 *   - **the body is text, never markup.** A comment is a stranger's text arriving from a
 *     public endpoint on the origin that holds the session cookie.
 */

vi.mock('../../lib/community/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/comments')>()),
  postComment: vi.fn(),
  replyToComment: vi.fn(),
  deleteComment: vi.fn(),
}));
vi.mock('../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const refresh = vi.fn();
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
    refresh: () => refresh(),
  }),
}));

const postMock = vi.mocked(postComment);
const replyMock = vi.mocked(replyToComment);
const deleteMock = vi.mocked(deleteComment);
const sessionMock = vi.mocked(fetchSession);

const PATH = '/projects/ayan/coffee-table-book';

const ACCOUNT: Session = {
  id: 'u1',
  email: 'ayan@example.com',
  name: 'Ayan Q',
  slug: 'ayan',
  emailVerified: true,
};

function comment(overrides: Partial<CampaignComment> = {}): CampaignComment {
  return {
    id: 'c1',
    threadId: 'c1',
    parentId: null,
    authorId: 'u9',
    body: 'Will this ship to Georgia?',
    byCreator: false,
    deleted: false,
    depth: 0,
    createdAt: '2026-08-01T10:00:00Z',
    acceptsReplies: true,
    ...overrides,
  };
}

function thread(overrides: Partial<CampaignCommentThread> = {}): CampaignCommentThread {
  return { root: comment(), replies: [], nextReplyCursor: null, ...overrides };
}

function page(threads: readonly CampaignCommentThread[]): CampaignCommentPage {
  return { threads, nextCursor: null };
}

async function renderTab(
  body: CampaignCommentPage | null,
  overrides: Partial<React.ComponentProps<typeof CampaignComments>> = {},
) {
  /*
   * `resolveServerTree` awaits the async server components in the tree before handing it to
   * a client-side renderer, which would otherwise draw them as nothing at all — see
   * `test-support/server-tree.tsx`.
   */
  return render(
    await resolveServerTree(
      <SessionProvider>
      <CampaignComments
        page={body}
        projectId="p1"
        campaignTitle="A coffee table book"
        returnTo={PATH}
        olderHref={null}
        singleThread={false}
        allThreadsHref={`${PATH}?tab=comments`}
        threadHrefs={{}}
        {...overrides}
      />
    </SessionProvider>,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(ACCOUNT);
  postMock.mockResolvedValue(null);
  replyMock.mockResolvedValue(null);
  deleteMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('the comments tab', () => {
  it('puts the conversation in the markup rather than in a request', async () => {
    await renderTab(page([thread()]));

    expect(await screen.findByText('Will this ship to Georgia?')).toBeInTheDocument();
  });

  it('marks the campaign’s own reply in words rather than only in colour', async () => {
    await renderTab(
      page([
        thread({
          replies: [
            comment({
              id: 'c2',
              parentId: 'c1',
              depth: 1,
              byCreator: true,
              body: 'Yes, Georgia is in zone 1.',
              acceptsReplies: false,
            }),
          ],
        }),
      ]),
    );

    expect(await screen.findByText('From the campaign')).toBeInTheDocument();
    expect(screen.getByText('Yes, Georgia is in zone 1.')).toBeInTheDocument();
  });

  it('renders a withdrawn comment as a tombstone that names nobody', async () => {
    const { container } = await renderTab(
      page([
        thread({
          root: comment({ deleted: true, body: null, authorId: null, acceptsReplies: false }),
          replies: [comment({ id: 'c2', parentId: 'c1', depth: 1, body: 'Still here.' })],
        }),
      ]),
    );

    expect(await screen.findByText('This comment was withdrawn.')).toBeInTheDocument();
    // The reply survives, which is the whole reason §4.9 keeps the row.
    expect(screen.getByText('Still here.')).toBeInTheDocument();
    // No name, and nothing that says who removed it.
    expect(container.textContent).not.toMatch(/removed by|deleted by/iu);
  });

  it('offers no controls under a tombstone', async () => {
    await renderTab(
      page([
        thread({ root: comment({ deleted: true, body: null, authorId: null, acceptsReplies: true }) }),
      ]),
    );

    await screen.findByText('This comment was withdrawn.');
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report/u })).not.toBeInTheDocument();
  });

  it('renders a comment body as text, never as markup', async () => {
    await renderTab(page([thread({ root: comment({ body: '<script>alert(1)</script>' }) })]));

    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument();
  });

  it('blames the service, not the campaign, when the read was refused', async () => {
    await renderTab(null);

    expect(screen.getByText(/could not be loaded/u)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody has commented/u)).not.toBeInTheDocument();
  });

  it('says nobody has commented only when nobody has', async () => {
    await renderTab(page([]));

    expect(screen.getByText('Nobody has commented on this campaign yet.')).toBeInTheDocument();
  });

  it('offers the rest of a long conversation as a link rather than as a press', async () => {
    await renderTab(
      page([thread({ nextReplyCursor: 'c50' })]),
      { threadHrefs: { c1: `${PATH}?tab=comments&thread=c1` } },
    );

    expect(await screen.findByRole('link', { name: 'Show more replies' })).toHaveAttribute(
      'href',
      `/en${PATH}?tab=comments&thread=c1`,
    );
  });
});

describe('the reply control', () => {
  it('is placed by acceptsReplies rather than by the depth', async () => {
    await renderTab(
      page([
        thread({
          root: comment({ acceptsReplies: false }),
          replies: [comment({ id: 'c2', depth: 1, acceptsReplies: false, body: 'Me too.' })],
        }),
      ]),
    );

    await screen.findByText('Will this ship to Georgia?');
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });

  it('posts an answer to the comment it was opened under', async () => {
    await renderTab(page([thread()]));

    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    await userEvent.type(screen.getByLabelText('Your reply'), 'Yes, it ships.');
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }));

    await waitFor(() => expect(replyMock).toHaveBeenCalledWith('c1', 'Yes, it ships.'));
    // The list is re-read rather than patched, so the server decides the nesting and the
    // creator highlight — see `CommentComposer` for why that is not an optimisation to make.
    expect(refresh).toHaveBeenCalled();
  });
});

describe('writing a comment', () => {
  it('posts to the campaign and asks the server to render the list again', async () => {
    await renderTab(page([]));

    await userEvent.type(await screen.findByLabelText('Add a comment'), 'When does it ship?');
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('p1', 'When does it ship?'));
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses an empty body without spending a request', async () => {
    await renderTab(page([]));

    await userEvent.click(await screen.findByRole('button', { name: 'Post comment' }));

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.failures.emptyBody)).toBeInTheDocument();
  });

  /**
   * #142: the four refusals the composer draws were English literals. Each is asserted through
   * the catalogue rather than retyped, so what is proved is that the composer asks for them.
   */
  it.each([
    ['an expired session', new ApiError(401), COPY.failures.sessionExpired],
    ['a rate limit with no retry time', new ApiError(429), COPY.failures.rateLimited],
    [
      'a rate limit that says how long',
      new ApiError(429, { status: 429, retryAfterSeconds: 290 }),
      pluralise('en', COPY.failures.rateLimitedFor, 5),
    ],
    ['a refusal with no words of its own', new ApiError(500), COPY.failures.notPosted],
    ['a service that never answered', new TypeError('Failed to fetch'), COPY.failures.unreachable],
  ])('says what went wrong after %s, in the catalogue’s words', async (_case, cause, expected) => {
    postMock.mockRejectedValue(cause);
    await renderTab(page([]));

    await userEvent.type(await screen.findByLabelText('Add a comment'), 'When does it ship?');
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('prefers the service’s own sentence when it sends one', async () => {
    postMock.mockRejectedValue(
      new ApiError(422, { status: 422, detail: 'Links are not allowed in comments.' }),
    );
    await renderTab(page([]));

    await userEvent.type(await screen.findByLabelText('Add a comment'), 'See example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(await screen.findByText('Links are not allowed in comments.')).toBeInTheDocument();
  });
});

/**
 * #142: the wait after a rate limit is a count only the browser knows, so it is declined with
 * `pluralise` — and Russian has three forms for minutes, picked by the last digit.
 */
describe('the rate-limit sentence in Russian', () => {
  const RU = {
    ...COPY.failures,
    rateLimitedFor: ru.campaign.comments.failures.rateLimitedFor,
  };

  it.each([
    [60, 'примерно через 1 минуту.'],
    [120, 'примерно через 2 минуты.'],
    [300, 'примерно через 5 минут.'],
    [1260, 'примерно через 21 минуту.'],
  ])('declines %i seconds as the right form of minutes', (seconds, ending) => {
    const cause = new ApiError(429, { status: 429, retryAfterSeconds: seconds });

    expect(messageFor(cause, RU, 'ru').endsWith(ending)).toBe(true);
  });

  it('offers a signed-out reader a sign-in that returns here, not a form', async () => {
    sessionMock.mockResolvedValue(null);
    await renderTab(page([]));

    const link = await screen.findByRole('link', { name: 'Sign in to comment' });
    expect(link).toHaveAttribute('href', `/en/sign-in?next=${encodeURIComponent(PATH)}`);
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument();
  });
});

describe('withdrawing a comment', () => {
  it('is offered to the author and to nobody else', async () => {
    await renderTab(page([thread({ root: comment({ authorId: 'u9' }) })]));

    await screen.findByText('Will this ship to Georgia?');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();

    cleanup();
    await renderTab(page([thread({ root: comment({ authorId: ACCOUNT.id }) })]));

    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  /**
   * §4.9 is explicit that this is not a removal. Somebody pressing it to make a sentence
   * disappear from the internet is entitled to know that it will still be there, marked as
   * withdrawn, for the moderator holding a report about it.
   */
  it('says what it actually does before it does it', async () => {
    await renderTab(page([thread({ root: comment({ authorId: ACCOUNT.id }) })]));

    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));

    expect(screen.getByText(/leaves a note saying the comment was removed/u)).toBeInTheDocument();
    expect(screen.getByText(/cannot be edited or restored/u)).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Withdraw it' }));



    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('c1'));
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ['a refusal with no words of its own', new ApiError(500), COPY.failures.notWithdrawn],
    ['a service that never answered', new TypeError('Failed to fetch'), COPY.failures.withdrawUnreachable],
  ])('says so in the catalogue’s words after %s (#142)', async (_case, cause, expected) => {
    deleteMock.mockRejectedValue(cause);
    await renderTab(page([thread({ root: comment({ authorId: ACCOUNT.id }) })]));

    await userEvent.click(await screen.findByRole('button', { name: COPY.withdraw }));
    await userEvent.click(screen.getByRole('button', { name: COPY.withdrawConfirm }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('accessibility', () => {
  /**
   * #129. The composer and a loaded thread, which is where the page's only free-text control
   * and its only nested list live. `src/test-axe.ts` says what an automated pass catches.
   */
  it('leaves no automatically detectable violation with threads or without', async () => {
    sessionMock.mockResolvedValue(ACCOUNT);

    const { container } = await renderTab(page([thread()]));
    await expectNoViolations(container);
    cleanup();

    const { container: empty } = await renderTab(page([]));
    await expectNoViolations(empty);
  });
});
