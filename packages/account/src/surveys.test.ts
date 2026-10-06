import { describe, expect, it } from 'vitest';
import {
  answerFor,
  needsAnAnswer,
  orderedQuestions,
  type BackerSurvey,
  type SurveyQuestion,
} from './surveys';

/**
 * §4.8's PM-05 and PM-06 — moved with the rules from the web's `lib/surveys/api.test.ts` (#159).
 *
 *   - **an unpositioned question does not jump to the top.** `position` is nullable on the wire,
 *     and a sort treating null as zero would silently reorder somebody else's survey.
 *   - "needs an answer" is open AND unanswered. A closed survey wants nothing whatever its state.
 */

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
    title: 'Pick a colour',
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

describe('orderedQuestions', () => {
  it('sorts by position and keeps arrival order for a tie', () => {
    const ordered = orderedQuestions(
      survey({
        questions: [
          question({ id: 'c', position: 2 }),
          question({ id: 'a', position: 1 }),
          question({ id: 'b', position: 1 }),
        ],
      }),
    );

    expect(ordered.map((q) => q.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts unpositioned questions last, in the order they arrived', () => {
    const ordered = orderedQuestions(
      survey({
        questions: [
          question({ id: 'loose-1' }),
          question({ id: 'first', position: 1 }),
          question({ id: 'loose-2' }),
          question({ id: 'zero', position: 0 }),
        ],
      }),
    );

    expect(ordered.map((q) => q.id)).toEqual(['zero', 'first', 'loose-1', 'loose-2']);
  });

  it('does not reorder the survey it was given', () => {
    const asked = survey({ questions: [question({ id: 'b', position: 2 }), question({ id: 'a', position: 1 })] });
    orderedQuestions(asked);
    expect(asked.questions.map((q) => q.id)).toEqual(['b', 'a']);
  });
});

describe('answerFor', () => {
  it('returns the stored value, and an empty list where there is none', () => {
    const one = survey({ answers: [{ questionId: 'q1', value: ['Blue'] }] });

    expect(answerFor(one, 'q1')).toEqual(['Blue']);
    expect(answerFor(one, 'q2')).toEqual([]);
  });
});

describe('needsAnAnswer', () => {
  it('is true only while a survey is open and unanswered', () => {
    expect(needsAnAnswer(survey({ open: true, answered: false }))).toBe(true);
    expect(needsAnAnswer(survey({ open: true, answered: true }))).toBe(false);
    expect(needsAnAnswer(survey({ open: false, answered: false }))).toBe(false);
  });
});
