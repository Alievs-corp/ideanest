import { describe, expect, it } from 'vitest';
import {
  QUESTION_TYPES,
  SURVEY_LIMITS,
  choicesFrom,
  emptyQuestion,
  hasChoices,
  offersRequired,
  questionsLocked,
  surveyBody,
  surveyFrom,
  withSurvey,
  withType,
  type Survey,
  type SurveyQuestion,
} from './surveys';

/**
 * §4.8's PM-01 to PM-04, the builder's rules with one right answer (#163):
 *
 *   - changing a question's type keeps its options only for CHOICE and MULTI_CHOICE;
 *   - ADDRESS offers no "required", because it is answered on the pledge;
 *   - a sent survey's questions are locked;
 *   - an empty tier condition is an absent `rewardTierId`, a chosen one is sent.
 */

function question(overrides: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return { ...emptyQuestion(), prompt: 'Which size?', ...overrides };
}

function survey(overrides: Partial<Survey> = {}): Survey {
  return { id: 's1', title: 'Sizes', sent: false, responseCount: 0, questions: [], ...overrides };
}

describe('the question types', () => {
  it('are offered text first and address last', () => {
    expect(QUESTION_TYPES).toEqual(['TEXT', 'CHOICE', 'MULTI_CHOICE', 'DATE', 'ADDRESS']);
  });

  it('carry options only when they are a choice', () => {
    expect(QUESTION_TYPES.filter(hasChoices)).toEqual(['CHOICE', 'MULTI_CHOICE']);
  });

  it('offer "required" for every type but ADDRESS', () => {
    expect(QUESTION_TYPES.filter((type) => !offersRequired(type))).toEqual(['ADDRESS']);
  });
});

describe('the service limits', () => {
  it('are 150 for a title, 2000 for the note and 300 for a question', () => {
    expect(SURVEY_LIMITS).toEqual({ title: 150, message: 2000, prompt: 300 });
  });
});

describe('withType', () => {
  const choice = question({ type: 'CHOICE', choices: ['S', 'M', 'L'] });

  it('keeps the options moving between the two choice types', () => {
    expect(withType(choice, 'MULTI_CHOICE').choices).toEqual(['S', 'M', 'L']);
  });

  it.each(['TEXT', 'DATE', 'ADDRESS'] as const)('drops the options for %s', (type) => {
    const changed = withType(choice, type);
    expect(changed.type).toBe(type);
    expect(changed.choices).toEqual([]);
  });

  it('leaves everything else as it was', () => {
    const changed = withType(question({ prompt: 'When?', rewardTierId: 'tier-1' }), 'DATE');
    expect(changed).toMatchObject({ prompt: 'When?', rewardTierId: 'tier-1' });
  });
});

describe('choicesFrom', () => {
  it('reads one option per line, trimmed, blank lines dropped', () => {
    expect(choicesFrom(' S \n\nM\r\n  \nL')).toEqual(['S', 'M', 'L']);
  });
});

describe('questionsLocked', () => {
  it('locks a sent survey and nothing else', () => {
    expect(questionsLocked(null)).toBe(false);
    expect(questionsLocked(survey())).toBe(false);
    expect(questionsLocked(survey({ sent: true }))).toBe(true);
  });
});

describe('surveyBody', () => {
  it('sends a chosen tier and leaves "everybody" out', () => {
    const body = surveyBody({
      title: 'Sizes',
      questions: [question({ rewardTierId: 'tier-1' }), question()],
    });
    expect(body.questions[0]?.rewardTierId).toBe('tier-1');
    expect(body.questions[1]?.rewardTierId).toBeUndefined();
  });

  it('sends options only for the choice types', () => {
    const body = surveyBody({
      title: 'Sizes',
      questions: [
        question({ type: 'CHOICE', choices: ['S', 'M'] }),
        { ...question({ type: 'TEXT' }), choices: ['left over'] },
      ],
    });
    expect(body.questions.map((each) => each.choices)).toEqual([['S', 'M'], []]);
  });

  it('never sends an identifier or a position, and leaves a blank note out', () => {
    const body = surveyBody({ title: 'Sizes', message: '   ', questions: [question({ id: 'q1' })] });
    expect(body.message).toBeUndefined();
    expect(body.questions[0]).not.toHaveProperty('id');
    expect(body.questions[0]).not.toHaveProperty('position');
  });
});

describe('surveyFrom', () => {
  it('reads a draft with its absent send fields absent', () => {
    const read = surveyFrom({ id: 's1', title: 'Sizes', sent: false, questions: [{ id: 'q1', prompt: 'Size?' }] });
    expect(read).toMatchObject({ id: 's1', sent: false, responseCount: 0 });
    expect(read.sentTo).toBeUndefined();
    expect(read.questions[0]).toEqual({
      id: 'q1',
      prompt: 'Size?',
      helpText: undefined,
      type: 'TEXT',
      required: false,
      choices: [],
      rewardTierId: '',
    });
  });
});

describe('withSurvey', () => {
  it('puts the saved survey first and drops its older copy', () => {
    const list = [survey({ id: 'a' }), survey({ id: 'b' })];
    expect(withSurvey(list, survey({ id: 'b', title: 'New' })).map((each) => each.id)).toEqual(['b', 'a']);
  });
});
