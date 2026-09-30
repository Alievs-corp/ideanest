import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/problem';
import { consoleMessageFor, requiredCapabilityFrom } from './refusals';
import { ROLE_CAPABILITIES, holds, type StaffMembership } from './staff';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../i18n/admin/common-copy';
import { staffRolesCopyFrom } from '../i18n/admin/people-copy';

/* Built from `messages/en.json` by the same functions the screen calls — see `src/test-copy.ts`. */
const CHROME = consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common'));
const STAFF = staffRolesCopyFrom(translatorFor('admin'), CHROME);

/**
 * What the console does with a role model — issue #295.
 *
 * <p>The interesting assertions here are about the two 403s. Before this epic there was one,
 * because there was one question: a caller was staff or was not. A moderator opening the
 * refund console got the same refusal as a stranger, which reads as a broken console rather
 * than as a screen that is not theirs — and the sentence somebody is shown decides whether
 * they go and ask an administrator for a role or go and file a bug.
 */

function forbidden(code: string, meta?: Record<string, unknown>): ApiError {
  return new ApiError(403, {
    status: 403,
    title: 'Forbidden',
    code,
    ...(meta === undefined ? {} : { meta }),
  });
}

describe('a refusal that names a capability', () => {
  it('reads the capability out of the problem meta', () => {
    expect(requiredCapabilityFrom(forbidden('INSUFFICIENT_STAFF_CAPABILITY', { capability: 'ISSUE_REFUND' }))).toBe(
      'ISSUE_REFUND',
    );
  });

  it('is null for a caller who does not work here at all', () => {
    // A stranger gets NOT_A_MODERATOR, which carries no capability — there is no role that
    // would have helped, and offering one to ask for would be misleading.
    expect(requiredCapabilityFrom(forbidden('NOT_A_MODERATOR'))).toBeNull();
  });

  it('is null when the service has not been redeployed since the role model', () => {
    // An older service answers the code with no meta. The screen must fall back to the
    // general refusal rather than rendering "needs undefined".
    expect(requiredCapabilityFrom(forbidden('INSUFFICIENT_STAFF_CAPABILITY'))).toBeNull();
    expect(requiredCapabilityFrom(forbidden('INSUFFICIENT_STAFF_CAPABILITY', { capability: 42 }))).toBeNull();
  });

  it('is null for anything that is not a refusal', () => {
    expect(requiredCapabilityFrom(new Error('the network went away'))).toBeNull();
    expect(requiredCapabilityFrom(null)).toBeNull();
  });
});

describe('the message a refused screen shows', () => {
  it('tells a colleague which capability to ask for', () => {
    const message = consoleMessageFor(
      forbidden('INSUFFICIENT_STAFF_CAPABILITY', { capability: 'APPROVE_PAYOUT' }),
      'the payout queue',
      CHROME.refusals,
    );

    expect(message).toContain('APPROVE_PAYOUT');
    expect(message).toContain('the payout queue');
  });

  it('tells a stranger something different', () => {
    const message = consoleMessageFor(forbidden('NOT_A_MODERATOR'), 'the ledger', CHROME.refusals);

    // The distinction #295 exists for: one of these is fixed by asking for a role, and the
    // other cannot be fixed by the person reading it.
    expect(message).not.toContain('roles do not include');
    expect(message).toContain('the ledger');
  });
});

describe('what a membership holds', () => {
  const finance: StaffMembership = {
    accountId: '00000000-0000-0000-0000-000000000001',
    staff: true,
    bootstrapped: false,
    roles: ['FINANCE'],
    capabilities: ['VIEW_FINANCE', 'ISSUE_REFUND', 'MANAGE_DISPUTES', 'HANDLE_SUPPORT', 'VIEW_AUDIT'],
  };

  it('answers for a capability it holds and one it does not', () => {
    expect(holds(finance, 'ISSUE_REFUND')).toBe(true);
    expect(holds(finance, 'APPROVE_PAYOUT')).toBe(false);
  });

  it('answers false for a reader whose membership has not loaded', () => {
    // Every screen calls this before the first response arrives. Failing closed means a
    // control is drawn disabled for a moment rather than enabled and then refused.
    expect(holds(null, 'VIEW_FINANCE')).toBe(false);
  });
});

describe('the role vocabulary', () => {
  it('describes every capability', () => {
    // A capability with no label renders as its constant on the grant screen, which is a
    // codebase identifier put in front of somebody deciding what a colleague may do.
    for (const [role, capabilities] of Object.entries(ROLE_CAPABILITIES)) {
      for (const capability of capabilities) {
        expect(
          STAFF.capability[capability],
          `${role} confers ${capability}, which has no label`,
        ).toBeTruthy();
      }
    }
  });

  it('keeps refunding and moderating in different roles', () => {
    // The browser's copy of the service's policy, checked against the same claim
    // `StaffRoleTests` makes on the other side. If these two ever disagree, the grant screen
    // is telling somebody they are granting something other than what they are.
    expect(ROLE_CAPABILITIES.MODERATOR).not.toContain('ISSUE_REFUND');
    expect(ROLE_CAPABILITIES.FINANCE).toContain('ISSUE_REFUND');
    expect(ROLE_CAPABILITIES.FINANCE).not.toContain('APPROVE_PAYOUT');
    expect(ROLE_CAPABILITIES.SUPER_ADMIN).toContain('ADMINISTER_STAFF');
  });
});
