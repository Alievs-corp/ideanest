import { sendJson } from '../../api/client';
import { listMySurveys, respondToSurvey, surveyFrom } from './api';

const mockGet = jest.fn();
jest.mock('../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));

const send = jest.mocked(sendJson);

beforeEach(() => jest.clearAllMocks());

describe('the survey endpoints', () => {
  it('reads absent fields as null, the shared shape, and an absent list as empty', async () => {
    mockGet.mockResolvedValueOnce({});
    expect(await listMySurveys()).toEqual([]);

    expect(surveyFrom({ surveyId: 's', pledgeId: 'p', questions: [{ id: 'q' }] })).toEqual({
      surveyId: 's',
      projectId: '',
      pledgeId: 'p',
      title: '',
      message: null,
      respondBy: null,
      open: false,
      answered: false,
      submittedAt: null,
      questions: [
        { id: 'q', position: null, prompt: '', helpText: null, type: 'TEXT', required: false, choices: [], rewardTierId: null },
      ],
      answers: [],
    });
  });

  it('posts the pledge and the answers to the survey, and returns the service’s survey', async () => {
    const asked = surveyFrom({ surveyId: 'sv/1', pledgeId: 'pledge-9', open: true });
    send.mockResolvedValueOnce({ surveyId: 'sv/1', pledgeId: 'pledge-9', open: true, answered: true });

    const updated = await respondToSurvey(asked, [{ questionId: 'q1', value: ['Blue'] }]);

    expect(send).toHaveBeenCalledWith('POST', '/v1/surveys/sv%2F1/respond', {
      pledgeId: 'pledge-9',
      answers: [{ questionId: 'q1', value: ['Blue'] }],
    });
    expect(updated.answered).toBe(true);
  });
});
