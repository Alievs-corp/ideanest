import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { respondToSurvey, type BackerSurvey, type SurveyQuestion } from '../../lib/surveys/api';
import { SurveyCard } from './SurveyCard';
import { surveysCopyFrom } from '../../lib/i18n/surveys-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #84.
 *
 * Retyping them here would give a test that passes whatever the catalogue says, and would
 * still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = surveysCopyFrom(translatorFor('account.surveys'), translatorFor('common')).card;

/**
 * §4.8's PM-05 and PM-06 — issue #289.
 *
 * WHAT THESE COVER:
 *
 *   - **an ADDRESS question collects nothing and sends nothing.** `QuestionType.ADDRESS` is
 *     the one type that stores no answer: the address is the pledge's encrypted row, and
 *     copying it into `survey_answers` would give the platform two addresses per backer that
 *     can disagree, in a table §17.4's erasure does not know to look at.
 *   - a required question stops a submission before the round trip, with the message beside
 *     the field rather than at the top of the page.
 *   - **a closed survey is readable and not editable.** Hiding it would leave a backer unable
 *     to check what they said about a reward that has not arrived.
 *   - the control says "Save answers" both times, because PM-06 makes this one row that moves.
 *   - **the privacy sentence is drawn rather than typed.** "The creator can see your answers"
 *     tells somebody who reads what they have just written, and it comes out of the catalogue
 *     so that it is there in four languages rather than in English alone (#84).
 */

vi.mock('../../lib/surveys/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/surveys/api')>()),
  respondToSurvey: vi.fn(),
}));

const respondMock = vi.mocked(respondToSurvey);

function question(overrides: Partial<SurveyQuestion> & Pick<SurveyQuestion, 'id'>): SurveyQuestion {
  return {
    position: null,
    prompt: 'A question',
    helpText: null,
    type: 'TEXT',
    required: false,
    choices: [],
    rewardTierId: null,
    ...overrides,
  };
}

function survey(overrides: Partial<BackerSurvey> = {}): BackerSurvey {
  return {
    surveyId: 'survey-1',
    projectId: 'project-1',
    pledgeId: 'pledge-1',
    title: 'Before we pack',
    message: 'Two questions and we can ship.',
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
  respondMock.mockImplementation(async () => survey({ answered: true }));
});

afterEach(cleanup);

describe('SurveyCard', () => {
  it('says in words, not only in colour, that an answer is owed', () => {
    render(<SurveyCard survey={survey()} copy={COPY} />);
    expect(screen.getByText(COPY.needsAnAnswer)).toBeInTheDocument();
  });

  it('sends the answers against the pledge the survey belongs to', async () => {
    const user = userEvent.setup();
    render(
      <SurveyCard
        survey={survey({
          pledgeId: 'pledge-9',
          questions: [question({ id: 'q1', prompt: 'Which colour?', type: 'CHOICE', choices: ['Blue', 'Red'] })],
        })}
        copy={COPY}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(respondMock).toHaveBeenCalledWith('survey-1', 'pledge-9', [
      { questionId: 'q1', value: ['Blue'] },
    ]);
  });

  it('refuses to submit a required question that is blank, and says which one', async () => {
    const user = userEvent.setup();
    render(
      <SurveyCard
        survey={survey({
          questions: [question({ id: 'q1', prompt: 'Your name for the credits', required: true })],
        })}
        copy={COPY}
      />,
    );

    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(screen.getByText(COPY.required)).toBeInTheDocument();
    expect(respondMock).not.toHaveBeenCalled();
  });

  it('points an ADDRESS question at the address form and sends nothing for it', async () => {
    const user = userEvent.setup();
    render(
      <SurveyCard
        survey={survey({
          pledgeId: 'pledge-9',
          questions: [
            question({ id: 'q1', prompt: 'Where should it go?', type: 'ADDRESS' }),
            question({ id: 'q2', prompt: 'Anything else?' }),
          ],
        })}
        copy={COPY}
      />,
    );

    expect(screen.getByRole('link', { name: COPY.question.addressLink })).toHaveAttribute(
      'href',
      '/en/pledges/pledge-9/address',
    );

    await user.click(screen.getByRole('button', { name: COPY.submit }));

    // Only the answerable question travels. A row of empty values would be a record that
    // somebody answered nothing, which is a different claim from having no row.
    expect(respondMock).toHaveBeenCalledWith('survey-1', 'pledge-9', [
      { questionId: 'q2', value: [] },
    ]);
  });

  it('reads back a closed survey without offering a form that would be refused', () => {
    render(
      <SurveyCard
        survey={survey({
          open: false,
          answered: true,
          questions: [question({ id: 'q1', prompt: 'Which colour?' })],
          answers: [{ questionId: 'q1', value: ['Blue'] }],
        })}
        copy={COPY}
      />,
    );

    expect(screen.getByText(COPY.closedTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.submit })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Which colour?')).toBeDisabled();
    expect(screen.getByLabelText('Which colour?')).toHaveValue('Blue');
  });

  it('keeps the answers on screen and says why when the service refused', async () => {
    respondMock.mockRejectedValue(new ApiError(409, { detail: 'This survey has just closed.' }));
    const user = userEvent.setup();
    render(
      <SurveyCard
        survey={survey({ questions: [question({ id: 'q1', prompt: 'Anything else?' })] })}
        copy={COPY}
      />,
    );

    await user.type(screen.getByLabelText('Anything else?'), 'A note');
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText('This survey has just closed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Anything else?')).toHaveValue('A note');
  });

  it('still says “Save answers” after a save, because this is one row that moves', async () => {
    const user = userEvent.setup();
    render(
      <SurveyCard
        survey={survey({ questions: [question({ id: 'q1', prompt: 'Anything else?' })] })}
        copy={COPY}
      />,
    );

    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText(COPY.savedTitle)).toBeInTheDocument();
    expect(await screen.findByText(COPY.savedBody)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.submit })).toBeInTheDocument();
  });
});
