import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { listMySurveys, respondToSurvey, type BackerSurvey } from './api';

/**
 * §4.8's PM-05 and PM-06 — issue #289.
 *
 * WHAT THESE COVER (the ordering rules moved to `@ideanest/account/surveys` with their tests, #159):
 *
 *   - the pledge travels in the body, because one account can hold two pledges on one
 *     campaign and the survey is asked of a pledge.
 */

const originalFetch = globalThis.fetch;

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

beforeEach(() => setAccessToken('a-token'));
afterEach(() => {
  setAccessToken(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('the endpoints', () => {
  it('reads an absent list as empty rather than undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );

    expect(await listMySurveys()).toEqual([]);
  });

  it('names the pledge the answers belong to', async () => {
    // The stub declares its parameters, or `mock.calls` is typed `[]` and the body below
    // cannot be read without casting through `unknown`.
    const send = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        new Response(JSON.stringify(survey({ answered: true })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', send);

    await respondToSurvey('survey-1', 'pledge-9', [{ questionId: 'q1', value: ['Blue'] }]);

    expect(send.mock.calls[0]?.[0]).toBe('/v1/surveys/survey-1/respond');
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({
      pledgeId: 'pledge-9',
      answers: [{ questionId: 'q1', value: ['Blue'] }],
    });
  });
});
