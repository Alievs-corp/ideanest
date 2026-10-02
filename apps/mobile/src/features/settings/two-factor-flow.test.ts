import { ApiError } from '@ideanest/api-client';
import {
  INITIAL_TWO_FACTOR,
  canFinish,
  isAlreadyEnabled,
  twoFactorReducer,
  type TwoFactorEvent,
  type TwoFactorState,
} from './two-factor-flow';

const ENROLMENT = {
  secret: 'ABCDEFGHIJKLMNOP',
  otpauthUri: 'otpauth://totp/IdeyaNest:aysel?secret=ABCDEFGHIJKLMNOP&issuer=IdeyaNest',
  digits: 6,
  periodSeconds: 30,
  algorithm: 'SHA1',
};
const CODES = ['first code', 'second code'];
const FAILURE = { title: 'Refused', detail: 'That code is not right.', retryable: true };

function run(...events: TwoFactorEvent[]): TwoFactorState {
  return events.reduce(twoFactorReducer, INITIAL_TWO_FACTOR);
}

describe('the two-factor steps', () => {
  it('switches on through idle → password → scan → codes → idle', () => {
    let state = run({ type: 'setUp' });
    expect(state.step.kind).toBe('password');

    state = twoFactorReducer(state, { type: 'submitted' });
    expect(state.busy).toBe(true);
    state = twoFactorReducer(state, { type: 'enrolled', enrolment: ENROLMENT });
    expect(state.step).toEqual({ kind: 'scan', enrolment: ENROLMENT });
    expect(state.busy).toBe(false);

    state = run(
      { type: 'setUp' },
      { type: 'submitted' },
      { type: 'enrolled', enrolment: ENROLMENT },
      { type: 'submitted' },
      { type: 'confirmed', codes: CODES },
    );
    expect(state.step).toEqual({ kind: 'codes', codes: CODES, acknowledged: false });

    state = twoFactorReducer(state, { type: 'acknowledge', acknowledged: true });
    state = twoFactorReducer(state, { type: 'done' });
    expect(state.step).toEqual({ kind: 'idle' });
    expect(state.notice).toBe('enabled');
  });

  it('counts every step change, so the card knows when to move focus', () => {
    const state = run(
      { type: 'setUp' },
      { type: 'submitted' },
      { type: 'enrolled', enrolment: ENROLMENT },
      { type: 'submitted' },
      { type: 'refused', failure: FAILURE },
    );
    expect(state.moves).toBe(2);
    expect(INITIAL_TWO_FACTOR.moves).toBe(0);
  });

  it('goes to the off-path, with our notice, when the service says it is already on', () => {
    const state = run({ type: 'setUp' }, { type: 'submitted' }, { type: 'alreadyEnabled' });
    expect(state.step.kind).toBe('disable');
    expect(state.notice).toBe('alreadyEnabled');
    expect(state.busy).toBe(false);
    expect(state.failure).toBeNull();
  });

  it('switches off through idle → disable → idle', () => {
    let state = run({ type: 'turnOff' });
    expect(state.step.kind).toBe('disable');
    state = twoFactorReducer(twoFactorReducer(state, { type: 'submitted' }), { type: 'disabled' });
    expect(state.step.kind).toBe('idle');
    expect(state.notice).toBe('disabled');
  });

  it('gates "Done" on the acknowledgement', () => {
    const shown = run(
      { type: 'setUp' },
      { type: 'enrolled', enrolment: ENROLMENT },
      { type: 'confirmed', codes: CODES },
    );
    expect(canFinish(shown)).toBe(false);
    expect(twoFactorReducer(shown, { type: 'done' })).toBe(shown);

    const ticked = twoFactorReducer(shown, { type: 'acknowledge', acknowledged: true });
    expect(canFinish(ticked)).toBe(true);
    const unticked = twoFactorReducer(ticked, { type: 'acknowledge', acknowledged: false });
    expect(twoFactorReducer(unticked, { type: 'done' }).step.kind).toBe('codes');
  });

  it('cannot cancel away from the codes, nor in the middle of a request', () => {
    const codes = run(
      { type: 'setUp' },
      { type: 'enrolled', enrolment: ENROLMENT },
      { type: 'confirmed', codes: CODES },
    );
    expect(twoFactorReducer(codes, { type: 'cancel' })).toBe(codes);

    const sending = run({ type: 'setUp' }, { type: 'enrolled', enrolment: ENROLMENT }, { type: 'submitted' });
    expect(twoFactorReducer(sending, { type: 'cancel' })).toBe(sending);

    const scanning = twoFactorReducer(sending, { type: 'refused', failure: FAILURE });
    expect(twoFactorReducer(scanning, { type: 'cancel' }).step.kind).toBe('idle');
  });

  it('keeps the step on a refusal and clears the refusal on the next step', () => {
    const refused = run({ type: 'setUp' }, { type: 'submitted' }, { type: 'refused', failure: FAILURE });
    expect(refused.step.kind).toBe('password');
    expect(refused.failure).toEqual(FAILURE);
    expect(twoFactorReducer(refused, { type: 'cancel' }).failure).toBeNull();
  });

  it('ignores results that arrive for a step the reader has left', () => {
    const idle = run({ type: 'turnOff' }, { type: 'cancel' });
    expect(twoFactorReducer(idle, { type: 'enrolled', enrolment: ENROLMENT })).toBe(idle);
    expect(twoFactorReducer(idle, { type: 'confirmed', codes: CODES })).toBe(idle);
    expect(twoFactorReducer(idle, { type: 'disabled' })).toBe(idle);
  });

  it('dismisses the notice without leaving the step', () => {
    const state = run({ type: 'setUp' }, { type: 'alreadyEnabled' }, { type: 'dismissNotice' });
    expect(state.notice).toBeNull();
    expect(state.step.kind).toBe('disable');
  });
});

describe('isAlreadyEnabled', () => {
  it("recognises the service's own sentence, and nothing else", () => {
    const problem = (detail: string) =>
      new ApiError(400, { type: 'about:blank', title: 'Refused', status: 400, detail });
    expect(isAlreadyEnabled(problem('Two-factor authentication is already enabled.'))).toBe(true);
    expect(isAlreadyEnabled(problem('The password is not right.'))).toBe(false);
    expect(isAlreadyEnabled(new TypeError('Network request failed'))).toBe(false);
  });
});
