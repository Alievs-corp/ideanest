import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../i18n/admin/common-copy';
import { fillPlaceholders } from '../i18n/placeholders';
import { ApiError } from '../api/problem';
import { actionMessageFor, capabilityLabel, consoleMessageFor } from './refusals';

const REFUSALS = consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')).refusals;
const AZ = consoleChromeCopyFrom(translatorFor('admin', 'az'), translatorFor('common', 'az')).refusals;

const NEEDS_REFUND = new ApiError(403, {
  code: 'INSUFFICIENT_STAFF_CAPABILITY',
  title: 'Not yours to do',
  detail: 'This needs ISSUE_REFUND, which your roles do not include.',
  meta: { capability: 'ISSUE_REFUND' },
});

describe('a capability, as staff read it', () => {
  it('is the roles screen’s sentence with the identifier beside it', () => {
    const label = capabilityLabel('ISSUE_REFUND', AZ);
    expect(label).toBe('«Pulu geri qaytarmaq» (ISSUE_REFUND)');
  });

  it('is the identifier alone when there is no sentence for it', () => {
    expect(capabilityLabel('SOMETHING_NEW', REFUSALS)).toBe('SOMETHING_NEW');
  });
});

describe('a refused act', () => {
  it('says the act needs the capability, not that reading does', () => {
    const message = actionMessageFor(NEEDS_REFUND, 'the refund log', REFUSALS);

    expect(message).toBe(
      fillPlaceholders(REFUSALS.needsCapabilityToAct ?? '', { capability: capabilityLabel('ISSUE_REFUND', REFUSALS) }),
    );
    expect(message).not.toMatch(/Reading/);
  });

  it('says so in Azerbaijani with the capability in words', () => {
    expect(actionMessageFor(NEEDS_REFUND, 'geri qaytarma jurnalını', AZ)).toBe(
      'Bu əməliyyat üçün «Pulu geri qaytarmaq» (ISSUE_REFUND) səlahiyyəti lazımdır, rollarınız isə onu daxil etmir. Bunu administrator verə bilər.',
    );
  });

  it('turns Spring’s code-less 400 into "check the fields"', () => {
    const unreadable = new ApiError(400, { title: 'Bad Request', detail: 'Failed to read request' });

    expect(actionMessageFor(unreadable, 'the refund log', REFUSALS)).toBe(REFUSALS.invalidRequest);
    expect(actionMessageFor(new ApiError(400, { code: 'INVALID_REQUEST', title: 'Invalid request' }), 's', AZ)).toBe(
      AZ.invalidRequest,
    );
  });
});

describe('a refused read, as every other screen calls it', () => {
  it('still says reading needs the capability, now in words', () => {
    expect(consoleMessageFor(NEEDS_REFUND, 'the refund log', REFUSALS)).toBe(
      fillPlaceholders(REFUSALS.needsCapability, {
        subject: 'the refund log',
        capability: capabilityLabel('ISSUE_REFUND', REFUSALS),
      }),
    );
  });

  it('keeps the service’s sentence for a code-less 400, as before', () => {
    const unreadable = new ApiError(400, { title: 'Bad Request', detail: 'Failed to read request' });
    expect(consoleMessageFor(unreadable, 'the refund log', REFUSALS)).toBe('Failed to read request');
  });

  it('works with a refusal table built without the new sentences', () => {
    const { needsCapabilityToAct: _a, capabilityNamed: _b, capabilityNames: _c, invalidRequest: _d, ...older } = REFUSALS;

    expect(actionMessageFor(NEEDS_REFUND, 'the refund log', older)).toBe(
      fillPlaceholders(older.needsCapability, { subject: 'the refund log', capability: 'ISSUE_REFUND' }),
    );
    expect(actionMessageFor(new ApiError(400, { title: 'Bad Request' }), 's', older)).toBe(older.refused);
  });
});
