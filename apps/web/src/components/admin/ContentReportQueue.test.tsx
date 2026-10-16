import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listReports } from '../../lib/moderation/api';
import { lookUpNames } from '../../lib/admin/directory';
import { ContentReportQueue } from './ContentReportQueue';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { contentReportQueueCopyFrom } from '../../lib/i18n/admin/content-copy';

const COPY = contentReportQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/moderation/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/moderation/api')>()),
  listReports: vi.fn(),
}));

vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const listReportsMock = vi.mocked(listReports);

beforeEach(() => {
  vi.clearAllMocks();
  listReportsMock.mockResolvedValue({ state: 'OPEN', reports: [], nextCursor: null });
  vi.mocked(lookUpNames).mockResolvedValue({ accounts: [], projects: [] });
});

describe('the content report queue', () => {
  it('says which surface is being read, in a control that reports its state', async () => {
    render(<ContentReportQueue copy={COPY} />);

    const surfaces = screen.getByRole('group', { name: COPY.surfaceLabel });
    expect(surfaces).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.surface.COMMENT })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: COPY.surface.PROJECT_UPDATE })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await waitFor(() =>
      expect(listReportsMock).toHaveBeenCalledWith(expect.objectContaining({ target: 'COMMENT' })),
    );
  });

  it('switches the queue to updates without a release note above it', async () => {
    const user = userEvent.setup();
    render(<ContentReportQueue copy={COPY} />);

    await user.click(screen.getByRole('button', { name: COPY.surface.PROJECT_UPDATE }));

    expect(screen.getByRole('button', { name: COPY.surface.PROJECT_UPDATE })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(listReportsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ target: 'PROJECT_UPDATE' }),
      ),
    );
    expect(screen.queryByText(/#297/)).toBeNull();
  });
});
