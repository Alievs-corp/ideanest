import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readTemplateList } from '../../lib/admin/email-templates';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { emailTemplateIndexCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { EmailTemplateIndex } from './EmailTemplateIndex';

/*
 * The template list — the platform pages audit: rows are named in words, the list says which
 * languages each template has been rewritten in, and only the notice a recipient cannot switch off
 * is marked as such.
 */
const ADMIN = translatorFor('admin');
const COPY = emailTemplateIndexCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('../../lib/admin/email-templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/email-templates')>()),
  readTemplateList: vi.fn(),
}));

const listMock = vi.mocked(readTemplateList);

beforeEach(() => {
  vi.resetAllMocks();
  listMock.mockResolvedValue({
    templates: [
      { type: 'PAYMENT_FAILED', category: 'PAYMENTS', mandatory: false, overrides: [{ locale: 'az', liveVersion: 3 }] },
      { type: 'NEW_DEVICE_SIGN_IN', category: 'SECURITY', mandatory: true, overrides: [] },
      { type: 'PLEDGE_CONFIRMED', category: 'PLEDGES', mandatory: false },
    ],
  });
});

describe('the template list', () => {
  it('names each template in words, never by its constant', async () => {
    render(<EmailTemplateIndex copy={COPY} />);

    expect(await screen.findByText(COPY.type['PAYMENT_FAILED'] ?? '')).toBeInTheDocument();
    expect(screen.getByText(COPY.type['NEW_DEVICE_SIGN_IN'] ?? '')).toBeInTheDocument();
    expect(screen.queryByText('PAYMENT_FAILED')).not.toBeInTheDocument();
  });

  it('says which languages are rewritten and which version is live, and which send the shipped copy', async () => {
    render(<EmailTemplateIndex copy={COPY} />);

    expect(
      await screen.findByText(fillPlaceholders(COPY.rewritten, { language: COPY.language['az'] ?? '', version: '3' })),
    ).toBeInTheDocument();
    expect(screen.getAllByText(COPY.shippedOnly)).toHaveLength(2);
  });

  it('marks only the notice a recipient cannot switch off', async () => {
    render(<EmailTemplateIndex copy={COPY} />);

    expect(await screen.findAllByText(COPY.mandatory)).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<EmailTemplateIndex copy={COPY} />);
    await screen.findByText(COPY.type['PAYMENT_FAILED'] ?? '');

    await expectNoViolations(container);
  });
});
