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

describe('a refused read, by its code', () => {
  it('says why a reporting window was refused in the reader’s language, not the service’s', () => {
    for (const code of ['INVALID_ANALYTICS_RANGE', 'INVALID_DASHBOARD_RANGE']) {
      const refused = new ApiError(400, { code, title: 'That reporting window cannot be read', detail: 'A reporting window covers at most 366 days' });
      expect(consoleMessageFor(refused, 'the figures', AZ)).toBe(AZ.invalidRange);
    }
  });

  it('asks for the list to be reloaded when a "load more" position is no longer accepted', () => {
    const refused = new ApiError(400, { code: 'INVALID_CURSOR', detail: 'Send the nextCursor from the previous page, or nothing for the first.' });
    expect(consoleMessageFor(refused, 'the audit trail', AZ)).toBe(AZ.invalidCursor);
  });

  it('never prints Spring’s English title for a failure on the service’s side', () => {
    const failed = new ApiError(500, { title: 'Internal Server Error' });
    expect(consoleMessageFor(failed, 'the audit trail', AZ)).toBe(AZ.serviceFailed);
  });
});
