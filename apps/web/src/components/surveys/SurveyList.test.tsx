import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../lib/api/problem';
import { listMySurveys, type BackerSurvey } from '../../lib/surveys/api';
import { SurveyList } from './SurveyList';
import { surveysCopyFrom } from '../../lib/i18n/surveys-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #84.
 *
 * Retyping them here would give a test that passes whatever the catalogue says, and would
 * still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = surveysCopyFrom(translatorFor('account.surveys'), translatorFor('common'));

/**
 * §4.8's PM-05 — issue #289, translated under #84.
 *
 * WHAT THESE COVER:
 *
 *   - **what is still owed comes first.** A backer with four answered surveys and one
 *     outstanding should not have to look for the outstanding one.
 *   - **the count is declined rather than switched.** "One creator" against "{count} creators"
 *     is the whole of English and none of Russian, so the sentence comes from a plural group
 *     in the catalogue and `pluralise` picks the form — `lib/i18n/plurals.ts` carries why.
 *   - a refusal says what the service said, and a silence says the service was not reached;
 *     both from the catalogue rather than from a literal in the component.
 *   - the empty state offers somewhere to go, in `common`'s words — it is the same button the
 *     saved, following and pledge lists draw.
 */

vi.mock('../../lib/surveys/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/surveys/api')>()),
  listMySurveys: vi.fn(),
}));

const listMock = vi.mocked(listMySurveys);

function survey(overrides: Partial<BackerSurvey> & Pick<BackerSurvey, 'surveyId'>): BackerSurvey {
  return {
    projectId: 'project-1',
    pledgeId: `pledge-${overrides.surveyId}`,
    title: 'Before we pack',
    message: null,
    respondBy: null,
    open: true,
    answered: false,
    submittedAt: null,
    questions: [],
    answers: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
});

afterEach(cleanup);

describe('SurveyList', () => {
  it('says how many creators are waiting, in the form the count selects', async () => {
    listMock.mockResolvedValue([survey({ surveyId: 's1' })]);
    render(<SurveyList copy={COPY} />);

    expect(await screen.findByText(COPY.list.waitingTitle.one)).toBeInTheDocument();
    expect(screen.getByText(COPY.list.waitingBody)).toBeInTheDocument();
  });

  it('counts only the surveys that still owe an answer', async () => {
    listMock.mockResolvedValue([
      survey({ surveyId: 's1' }),
      survey({ surveyId: 's2', answered: true, submittedAt: '2026-01-02T10:00:00Z' }),
      survey({ surveyId: 's3' }),
      survey({ surveyId: 's4', open: false }),
    ]);
    render(<SurveyList copy={COPY} />);

    expect(
      await screen.findByText(fillPlaceholders(COPY.list.waitingTitle.other, { count: '2' })),
    ).toBeInTheDocument();
  });

  it('puts what is owed above what is already answered', async () => {
    listMock.mockResolvedValue([
      survey({ surveyId: 's1', answered: true, submittedAt: '2026-01-02T10:00:00Z' }),
      survey({ surveyId: 's2' }),
    ]);
    render(<SurveyList copy={COPY} />);

    const tags = await screen.findAllByText(
      (_, element) =>
        element?.textContent === COPY.card.needsAnAnswer ||
        element?.textContent === COPY.card.answered,
    );

    /* The unanswered one is announced before the answered one, whatever order the service sent. */
    expect(tags[0]).toHaveTextContent(COPY.card.needsAnAnswer);
  });

  it('says nothing about waiting when nothing is owed', async () => {
    listMock.mockResolvedValue([
      survey({ surveyId: 's1', answered: true, submittedAt: '2026-01-02T10:00:00Z' }),
    ]);
    render(<SurveyList copy={COPY} />);

    expect(await screen.findByText(COPY.card.answered)).toBeInTheDocument();
    expect(screen.queryByText(COPY.list.waitingBody)).not.toBeInTheDocument();
  });

  it('offers a way out of the empty state, in the words every other list uses', async () => {
    render(<SurveyList copy={COPY} />);

    expect(await screen.findByText(COPY.list.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.list.emptyBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.list.emptyAction })).toHaveAttribute(
      'href',
      '/en/discover',
    );
  });

  it('repeats what the service said when it refused', async () => {
    listMock.mockRejectedValue(new ApiError(409, { detail: 'Surveys are unavailable.' }));
    render(<SurveyList copy={COPY} />);

    expect(await screen.findByText(COPY.list.failedTitle)).toBeInTheDocument();
    expect(screen.getByText('Surveys are unavailable.')).toBeInTheDocument();
  });

  it('says the service was not reached when nothing answered at all', async () => {
    listMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SurveyList copy={COPY} />);

    expect(await screen.findByText(COPY.list.unreachable)).toBeInTheDocument();
  });

  it('draws nothing at all for a reader who is not signed in', async () => {
    listMock.mockRejectedValue(new ApiError(401));
    const { container } = render(<SurveyList copy={COPY} />);

    /*
     * The account shell has already decided what a signed-out reader sees. A second refusal
     * inside the panel would be two messages about one fact.
     */
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
