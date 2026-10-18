import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  activateVersion,
  publishDocument,
  readDocumentHistory,
  writeDraft,
  type DocumentHistory,
  type DocumentKind,
  type DocumentSummary,
} from '../../lib/admin/legal';
import { bakuDate, calendarDate } from '../../lib/admin/console-dates';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { legalDocumentEditorCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { LegalDocumentEditor } from './LegalDocumentEditor';

/*
 * The legal documents screen — the platform pages audit: a document's draft never appears under
 * another, typed text survives a language switch, publishing and choosing a version ask in words
 * first, dates are Baku's, and every refusal is in the reader's language.
 */
const ADMIN = translatorFor('admin');
const COPY = legalDocumentEditorCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('../../lib/admin/legal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/legal')>()),
  readDocumentHistory: vi.fn(),
  writeDraft: vi.fn(),
  publishDocument: vi.fn(),
  activateVersion: vi.fn(),
}));

const historyMock = vi.mocked(readDocumentHistory);
const draftMock = vi.mocked(writeDraft);
const publishMock = vi.mocked(publishDocument);
const activateMock = vi.mocked(activateVersion);

const HASH = 'a3f1c9e2b4d6f8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8';

function summary(overrides: Partial<DocumentSummary>): DocumentSummary {
  return {
    kind: 'TERMS_OF_USE',
    locale: 'az',
    version: 1,
    title: 'İstifadə şərtləri',
    contentHash: HASH,
    effectiveFrom: '2026-09-30T20:00:00Z',
    publishedAt: '2026-09-29T08:00:00Z',
    ...overrides,
  };
}

function historyOf(kind: DocumentKind, overrides: Partial<DocumentHistory> = {}): DocumentHistory {
  return { kind, versions: [], drafts: [], ...overrides };
}

const TERMS_DRAFT = { kind: 'TERMS_OF_USE', locale: 'az', version: 2, title: 'Şərtlər', body: 'Şərtlərin mətni.', contentHash: HASH };

beforeEach(() => {
  vi.resetAllMocks();
  historyMock.mockImplementation(async (kind) =>
    kind === 'TERMS_OF_USE'
      ? historyOf(kind, {
          versions: [summary({}), summary({ locale: 'en', title: 'Terms of use' })],
          drafts: [TERMS_DRAFT],
          inForceVersion: 1,
        })
      : historyOf(kind),
  );
});

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`));

describe('one document at a time', () => {
  it('never shows one document’s draft under another', async () => {
    const user = userEvent.setup();
    let release: (value: DocumentHistory) => void = () => undefined;
    render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    historyMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await user.selectOptions(field(COPY.documentLabel), 'PRIVACY_POLICY');

    expect(screen.queryByDisplayValue('Şərtlər')).not.toBeInTheDocument();
    release(historyOf('PRIVACY_POLICY'));
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue(''));
  });

  it('keeps typed text across a language switch, holds publishing until it is saved, and asks before leaving the document', async () => {
    const user = userEvent.setup();
    render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    await user.type(field(COPY.titleLabel), ' yeni');
    await user.selectOptions(field(COPY.languageLabel), 'en');
    expect(field(COPY.titleLabel)).toHaveValue('');
    await user.selectOptions(field(COPY.languageLabel), 'az');
    expect(field(COPY.titleLabel)).toHaveValue('Şərtlər yeni');

    expect(
      screen.getByText(fillPlaceholders(COPY.unsavedBody, { languages: COPY.languageName['az'] ?? '' })),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.publish })).toBeDisabled();

    await user.selectOptions(field(COPY.documentLabel), 'COOKIE_POLICY');
    const asked = screen.getByRole('group', { name: COPY.switchDocumentLabel });
    await user.click(within(asked).getByRole('button', { name: COPY.back }));
    expect(field(COPY.titleLabel)).toHaveValue('Şərtlər yeni');
  });

  it('says so when the document could not be read, instead of blank sections', async () => {
    historyMock.mockRejectedValue(new ApiError(500, { detail: 'Internal Server Error' }));
    render(<LegalDocumentEditor copy={COPY} />);

    expect(await screen.findByText(COPY.readFailed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.draftHeading)).not.toBeInTheDocument();
    expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument();
  });
});

describe('saving and publishing', () => {
  it('names the saved language in words', async () => {
    const user = userEvent.setup();
    draftMock.mockResolvedValue({ ...TERMS_DRAFT, title: 'Şərtlər 2' });
    render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    await user.type(field(COPY.titleLabel), ' 2');
    await user.click(screen.getByRole('button', { name: COPY.save }));

    expect(
      await screen.findByText(fillPlaceholders(COPY.savedNotice, { language: COPY.languageName['az'] ?? '', version: '2' })),
    ).toBeInTheDocument();
    expect(screen.queryByText(COPY.unsavedTitle)).not.toBeInTheDocument();
  });

  it('asks before publishing, naming the document, version, languages and date, and sends a Baku midnight', async () => {
    const user = userEvent.setup();
    publishMock.mockResolvedValue({ documents: [summary({ version: 2, effectiveFrom: '2030-01-14T20:00:00Z' })] });
    render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    await user.type(field(COPY.effectiveFromLabel), '2030-01-15');
    await user.click(screen.getByRole('button', { name: COPY.publish }));
    expect(publishMock).not.toHaveBeenCalled();

    const asked = screen.getByRole('group', { name: COPY.confirmPublishLabel });
    expect(
      within(asked).getByText(
        fillPlaceholders(COPY.confirmPublish, {
          document: COPY.kind['TERMS_OF_USE'] ?? '',
          version: '2',
          languages: COPY.languageName['az'] ?? '',
          when: fillPlaceholders(COPY.whenDate, { date: calendarDate('2030-01-15', 'en') }),
        }),
      ),
    ).toBeInTheDocument();

    await user.click(within(asked).getByRole('button', { name: COPY.confirmPublishAction }));
    expect(publishMock).toHaveBeenCalledWith({ kind: 'TERMS_OF_USE', effectiveFrom: '2030-01-14T20:00:00.000Z' });
    expect(
      await screen.findByText(
        fillPlaceholders(COPY.publishedFuture, {
          version: '2',
          languages: COPY.languageName['az'] ?? '',
          date: calendarDate('2030-01-15', 'en'),
        }),
      ),
    ).toBeInTheDocument();
  });

  it('offers no day before tomorrow in Baku', async () => {
    render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const tomorrow = new Date(`${today}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    expect(field(COPY.effectiveFromLabel)).toHaveAttribute('min', tomorrow.toISOString().slice(0, 10));
  });

  it('says who must accept an agreement again', async () => {
    const user = userEvent.setup();
    historyMock.mockImplementation(async (kind) =>
      historyOf(kind, { drafts: [{ ...TERMS_DRAFT, kind: 'CREATOR_AGREEMENT', version: 1 }] }),
    );
    render(<LegalDocumentEditor copy={COPY} />);
    await user.selectOptions(field(COPY.documentLabel), 'CREATOR_AGREEMENT');
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    await user.click(screen.getByRole('button', { name: COPY.publish }));
    const asked = screen.getByRole('group', { name: COPY.confirmPublishLabel });
    expect(asked).toHaveTextContent(COPY.reaccept['CREATOR_AGREEMENT'] ?? '');
  });

  it('words a refused publication in the reader’s language and reads the document again', async () => {
    const user = userEvent.setup();
    publishMock.mockRejectedValue(new ApiError(409, { code: 'NOTHING_TO_PUBLISH', detail: 'Write the text first.' }));
    render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    await user.click(screen.getByRole('button', { name: COPY.publish }));
    await user.click(
      within(screen.getByRole('group', { name: COPY.confirmPublishLabel })).getByRole('button', { name: COPY.confirmPublishAction }),
    );

    expect(await screen.findByText(COPY.errors['NOTHING_TO_PUBLISH'] ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Write the text first.')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenCalledTimes(2);
  });
});

describe('the versions', () => {
  it('lists each version once with its languages, dates it in Baku, and links to the public page', async () => {
    render(<LegalDocumentEditor copy={COPY} />);

    const item = (await screen.findByText(fillPlaceholders(COPY.versionLabel, { version: '1' }))).closest('li');
    expect(item).not.toBeNull();
    const row = within(item as HTMLElement);
    expect(row.getByText(COPY.languageName['az'] ?? '')).toBeInTheDocument();
    expect(row.getByText(COPY.languageName['en'] ?? '')).toBeInTheDocument();
    expect(row.getByText(COPY.shownOnSite)).toBeInTheDocument();
    expect(
      row.getByText(fillPlaceholders(COPY.versionMeta, { from: bakuDate('2026-09-30T20:00:00Z', 'en'), hash: HASH.slice(0, 12) })),
    ).toBeInTheDocument();
    expect(row.getByRole('link', { name: COPY.openOnSite })).toHaveAttribute('href', expect.stringContaining('/legal/terms-of-use/v/1'));
    expect(screen.getAllByText(fillPlaceholders(COPY.versionLabel, { version: '1' }))).toHaveLength(1);
  });

  it('marks a version waiting for its date and offers no way to show it early', async () => {
    historyMock.mockResolvedValue(
      historyOf('TERMS_OF_USE', {
        versions: [summary({ version: 2, effectiveFrom: '2099-03-01T20:00:00Z' }), summary({})],
        inForceVersion: 1,
      }),
    );
    render(<LegalDocumentEditor copy={COPY} />);

    const item = (await screen.findByText(fillPlaceholders(COPY.versionLabel, { version: '2' }))).closest('li') as HTMLElement;
    expect(
      within(item).getByText(fillPlaceholders(COPY.takesEffect, { date: bakuDate('2099-03-01T20:00:00Z', 'en') })),
    ).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: COPY.showOnSite })).not.toBeInTheDocument();
  });

  it('asks before showing an earlier version', async () => {
    const user = userEvent.setup();
    historyMock.mockResolvedValue(
      historyOf('TERMS_OF_USE', { versions: [summary({ version: 2 }), summary({})], inForceVersion: 2 }),
    );
    activateMock.mockResolvedValue({ documents: [summary({})] });
    render(<LegalDocumentEditor copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.showOnSite }));
    expect(activateMock).not.toHaveBeenCalled();
    const asked = screen.getByRole('group', { name: COPY.confirmActivateLabel });
    expect(
      within(asked).getByText(fillPlaceholders(COPY.confirmActivate, { document: COPY.kind['TERMS_OF_USE'] ?? '', version: '1' })),
    ).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: COPY.showOnSite }));

    expect(activateMock).toHaveBeenCalledWith('TERMS_OF_USE', 1);
    expect(await screen.findByText(fillPlaceholders(COPY.activatedNotice, { version: '1' }))).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<LegalDocumentEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.titleLabel)).toHaveValue('Şərtlər'));

    await expectNoViolations(container);
  });
});
