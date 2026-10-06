import type { BackerSurvey, SurveyQuestion } from '@ideanest/account/surveys';
import {
  answersToSend,
  dateAnswerOf,
  dateOfAnswer,
  draftFrom,
  keepOrder,
  missingAnswers,
  outstandingFirst,
  surveyKey,
  toggleChoice,
} from './survey-form';

function question(id: string, extra: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return { id, position: null, prompt: id, helpText: null, type: 'TEXT', required: false, choices: [], rewardTierId: null, ...extra };
}

function survey(id: string, extra: Partial<BackerSurvey> = {}): BackerSurvey {
  return {
    surveyId: id,
    projectId: 'p',
    pledgeId: 'pl',
    title: id,
    message: null,
    respondBy: null,
    open: true,
    answered: false,
    submittedAt: null,
    questions: [],
    answers: [],
    ...extra,
  };
}

describe('outstandingFirst', () => {
  it('puts open, unanswered surveys first and keeps the service order inside each group', () => {
    const list = [
      survey('answered', { answered: true }),
      survey('owed-1'),
      survey('closed', { open: false }),
      survey('owed-2'),
      survey('closed-unanswered', { open: false, answered: false }),
    ];
    expect(outstandingFirst(list).map((entry) => entry.surveyId)).toEqual([
      'owed-1',
      'owed-2',
      'answered',
      'closed',
      'closed-unanswered',
    ]);
  });
});

describe('keepOrder', () => {
  it('keeps the last order while the same surveys are listed, so a saved card does not jump', () => {
    const first = outstandingFirst([survey('a', { answered: true }), survey('b')]);
    const order = first.map(surveyKey);
    const afterSave = [survey('a', { answered: true }), survey('b', { answered: true })];
    expect(keepOrder(order, afterSave).map((entry) => entry.surveyId)).toEqual(['b', 'a']);
  });

  it('sorts again when a survey arrives or when asked to (a pull to refresh)', () => {
    const list = [survey('a', { answered: true }), survey('b')];
    expect(keepOrder(['a:pl', 'b:pl'], [...list, survey('c')]).map((entry) => entry.surveyId)).toEqual(['b', 'c', 'a']);
    expect(keepOrder(null, list).map((entry) => entry.surveyId)).toEqual(['b', 'a']);
  });

  it('tells two pledges on one survey apart', () => {
    expect(surveyKey(survey('s', { pledgeId: 'one' }))).not.toBe(surveyKey(survey('s', { pledgeId: 'two' })));
  });
});

describe('the request', () => {
  const asked = survey('s', {
    questions: [
      question('size', { type: 'CHOICE', required: true, choices: ['S', 'M'], position: 2 }),
      question('where', { type: 'ADDRESS', position: 1 }),
      question('note', { position: 3 }),
    ],
    answers: [{ questionId: 'note', value: ['Thanks'] }],
  });

  it('reports required questions left empty, and never an ADDRESS question', () => {
    expect(missingAnswers(asked, draftFrom(asked))).toEqual(['size']);
    expect(missingAnswers(asked, { ...draftFrom(asked), size: ['M'] })).toEqual([]);
  });

  it('leaves ADDRESS questions out of the answers, in question order', () => {
    expect(answersToSend(asked, { ...draftFrom(asked), size: ['M'] })).toEqual([
      { questionId: 'size', value: ['M'] },
      { questionId: 'note', value: ['Thanks'] },
    ]);
  });
});

describe('toggleChoice', () => {
  const choices = ['Red', 'Green', 'Blue'];

  it('saves in the order of the choices, not the order they were ticked', () => {
    let value: readonly string[] = [];
    value = toggleChoice(choices, value, 'Blue', true);
    value = toggleChoice(choices, value, 'Red', true);
    expect(value).toEqual(['Red', 'Blue']);
    value = toggleChoice(choices, value, 'Green', true);
    expect(value).toEqual(['Red', 'Green', 'Blue']);
  });

  it('removes an unticked choice', () => {
    expect(toggleChoice(choices, ['Red', 'Blue'], 'Red', false)).toEqual(['Blue']);
  });
});

describe('DATE answers', () => {
  // jest.config.js runs every suite in Asia/Baku (UTC+4): the zone where UTC turns the first
  // hours of a day into the day before.
  it('writes the phone’s calendar day as YYYY-MM-DD, with no time zone conversion', () => {
    const justAfterMidnight = new Date(2026, 9, 6, 0, 30);
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(dateAnswerOf(justAfterMidnight)).toBe('2026-10-06');
    expect(dateAnswerOf(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
    expect(dateAnswerOf(new Date(2027, 2, 4, 12))).toBe('2027-03-04');
  });

  it('reads an answer back as the same day, and refuses what is not a date', () => {
    const day = dateOfAnswer('2026-02-28');
    expect(day).not.toBeNull();
    expect(dateAnswerOf(day as Date)).toBe('2026-02-28');
    expect(dateOfAnswer('2026-02-30')).toBeNull();
    expect(dateOfAnswer('28.02.2026')).toBeNull();
    expect(dateOfAnswer(undefined)).toBeNull();
  });
});
