import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { lookUpNames } from '../../lib/admin/directory';
import {
  editTemplate,
  previewDraft,
  readTemplateDraft,
  readTemplateHistory,
  testSendDraft,
  withdrawTemplate,
  type EmailTemplateDraft,
  type EmailTemplateVersion,
} from '../../lib/admin/email-templates';
import { bakuDateTime } from '../../lib/admin/console-dates';
import { actionMessageFor, consoleMessageFor } from '../../lib/admin/refusals';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { emailTemplateEditorCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { EmailTemplateEditor } from './EmailTemplateEditor';

/*
 * The template editor — the platform pages audit: it edits one language at a time and says who
 * that reaches, names every placeholder by what it means, previews unsaved text, asks before
 * anything goes live, words every refusal, and names who wrote each version.
 */
const ADMIN = translatorFor('admin');
const COPY = emailTemplateEditorCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('../../lib/admin/email-templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/email-templates')>()),
  readTemplateDraft: vi.fn(),
  readTemplateHistory: vi.fn(),
  editTemplate: vi.fn(),
  withdrawTemplate: vi.fn(),
  previewDraft: vi.fn(),
  testSendDraft: vi.fn(),
}));
vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const draftMock = vi.mocked(readTemplateDraft);
const historyMock = vi.mocked(readTemplateHistory);
const editMock = vi.mocked(editTemplate);
const withdrawMock = vi.mocked(withdrawTemplate);
const previewMock = vi.mocked(previewDraft);
const testSendMock = vi.mocked(testSendDraft);
const namesMock = vi.mocked(lookUpNames);

const ADMIN_ID = '7d3c2a10-5b1e-4f0a-9c2d-0a1b2c3d4e01';

function shipped(overrides: Partial<EmailTemplateDraft> = {}): EmailTemplateDraft {
  return {
    type: 'PLEDGE_CONFIRMED',
    locale: 'az',
    shippedSubject: 'Dəstəyiniz təsdiqləndi',
    shippedBody: '{2} məbləğində dəstəyiniz təsdiqləndi.',
    shippedSubjectNamed: '{1} kampaniyasına dəstəyiniz təsdiqləndi',
    shippedBodyNamed: '{1} kampaniyasına {2} məbləğində dəstəyiniz təsdiqləndi.',
    requiredPlaceholders: ['1', '2'],
    availablePlaceholders: ['0', '1', '2'],
    ...overrides,
  };
}

function version(overrides: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return {
    id: 'e7a00000-0000-4000-8000-000000000001',
    templateKey: 'PLEDGE_CONFIRMED',
    locale: 'az',
    version: 1,
    subject: '{1}: qəbul olundu',
    body: '{1} üçün {2} qəbul olundu.',
    requiredPlaceholders: ['1', '2'],
    live: true,
    note: 'Daha qısa',
    createdAt: '2026-10-14T21:30:00Z',
    createdBy: ADMIN_ID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  draftMock.mockResolvedValue(shipped());
  historyMock.mockResolvedValue({ versions: [] });
  namesMock.mockResolvedValue({ accounts: [{ id: ADMIN_ID, name: 'Kamran Əliyev', slug: 'kamran' }], projects: [] });
});

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`));

describe('one language at a time', () => {
  it('opens in Azerbaijani, starts from the campaign-named copy, and says who the text reaches', async () => {
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);

    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));
    expect(draftMock).toHaveBeenCalledWith('PLEDGE_CONFIRMED', 'az', expect.anything());
    expect(screen.getByText(new RegExp(fillPlaceholders(COPY.reach, { language: COPY.language['az'] ?? '' }).slice(0, 30)))).toBeInTheDocument();
    expect(screen.getByText(COPY.shippedNamedLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.shippedPlainLabel)).toBeInTheDocument();
  });

  it('reads the other language when switched, and asks first when there is unsaved text', async () => {
    const user = userEvent.setup();
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.type(field(COPY.subjectLabel), '!');
    await user.selectOptions(field(COPY.languageLabel), 'en');

    const asked = screen.getByRole('group', { name: COPY.switchLabel });
    await user.click(within(asked).getByRole('button', { name: COPY.back }));
    expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi!');
    expect(draftMock).not.toHaveBeenCalledWith('PLEDGE_CONFIRMED', 'en', expect.anything());

    draftMock.mockResolvedValue(shipped({ locale: 'en', shippedSubjectNamed: 'Your pledge to {1} is confirmed' }));
    await user.selectOptions(field(COPY.languageLabel), 'en');
    await user.click(within(screen.getByRole('group', { name: COPY.switchLabel })).getByRole('button', { name: COPY.switchAction }));

    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('Your pledge to {1} is confirmed'));
    expect(draftMock).toHaveBeenCalledWith('PLEDGE_CONFIRMED', 'en', expect.anything());
    expect(screen.queryByText(COPY.reachPrimary)).not.toBeInTheDocument();
  });
});

describe('what an edit must keep', () => {
  it('names each placeholder by what it means and refuses to save one that drops the campaign', async () => {
    const user = userEvent.setup();
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    expect(screen.getByText(`— ${COPY.placeholder['2']}`)).toBeInTheDocument();
    expect(screen.getAllByText(COPY.mustKeep)).toHaveLength(2);

    await user.clear(field(COPY.subjectLabel));
    await user.type(field(COPY.subjectLabel), 'Qəbul olundu');
    await user.clear(field(COPY.bodyLabel));
    await user.type(field(COPY.bodyLabel), '{{2} qəbul olundu.');

    expect(
      screen.getByText(fillPlaceholders(COPY.missingBody, { placeholders: `{1} — ${COPY.placeholder['1']}` })),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.saveNew })).toBeDisabled();
  });

  it('words the service refusal by what is missing, never in its English', async () => {
    const user = userEvent.setup();
    editMock.mockRejectedValue(
      new ApiError(422, { code: 'MISSING_TEMPLATE_PLACEHOLDER', detail: 'Keep every placeholder.', meta: { missing: ['2'] } }),
    );
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.click(screen.getByRole('button', { name: COPY.saveNew }));
    await user.click(within(screen.getByRole('group', { name: COPY.confirmSaveLabel })).getByRole('button', { name: COPY.confirmSaveAction }));

    expect(
      await screen.findByText(fillPlaceholders(COPY.missingBody, { placeholders: `{2} — ${COPY.placeholder['2']}` })),
    ).toBeInTheDocument();
    expect(screen.queryByText('Keep every placeholder.')).not.toBeInTheDocument();
  });

  it('says a write needs the capability, rather than that reading does', async () => {
    const user = userEvent.setup();
    const refusal = new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'CONFIGURE_PLATFORM' } });
    editMock.mockRejectedValue(refusal);
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.click(screen.getByRole('button', { name: COPY.saveNew }));
    await user.click(within(screen.getByRole('group', { name: COPY.confirmSaveLabel })).getByRole('button', { name: COPY.confirmSaveAction }));

    expect(await screen.findByText(actionMessageFor(refusal, COPY.subject, COPY.refusals))).toBeInTheDocument();
    expect(actionMessageFor(refusal, COPY.subject, COPY.refusals)).not.toBe(
      consoleMessageFor(refusal, COPY.subject, COPY.refusals),
    );
  });

  it('explains a malformed placeholder in the reader’s words', async () => {
    const user = userEvent.setup();
    editMock.mockRejectedValue(
      new ApiError(422, { code: 'TEMPLATE_COPY_MALFORMED', meta: { field: 'body', reason: 'SYNTAX' } }),
    );
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.click(screen.getByRole('button', { name: COPY.saveNew }));
    await user.click(within(screen.getByRole('group', { name: COPY.confirmSaveLabel })).getByRole('button', { name: COPY.confirmSaveAction }));

    expect(
      await screen.findByText(fillPlaceholders(COPY.malformedBody, { field: COPY.field.body, example: '{2}' })),
    ).toBeInTheDocument();
  });
});

describe('nothing goes live by accident', () => {
  it('asks before saving, naming the version and the language, and saves that language', async () => {
    const user = userEvent.setup();
    editMock.mockResolvedValue(version({ version: 1 }));
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.clear(field(COPY.subjectLabel));
    await user.type(field(COPY.subjectLabel), '{{1}: qəbul olundu');
    await user.click(screen.getByRole('button', { name: COPY.saveNew }));

    expect(editMock).not.toHaveBeenCalled();
    const asked = screen.getByRole('group', { name: COPY.confirmSaveLabel });
    expect(
      within(asked).getByText(fillPlaceholders(COPY.confirmSave, { version: '1', language: COPY.language['az'] ?? '' })),
    ).toBeInTheDocument();

    await user.click(within(asked).getByRole('button', { name: COPY.confirmSaveAction }));

    expect(editMock).toHaveBeenCalledWith(
      'PLEDGE_CONFIRMED',
      'az',
      '{1}: qəbul olundu',
      '{1} kampaniyasına {2} məbləğində dəstəyiniz təsdiqləndi.',
      null,
    );
    expect(await screen.findByText(fillPlaceholders(COPY.savedNew, { version: '1' }))).toBeInTheDocument();
    expect(screen.getByText(COPY.overriddenTitle)).toBeInTheDocument();
  });

  it('previews the unsaved text in a sandboxed frame, and says when the text has moved on', async () => {
    const user = userEvent.setup();
    previewMock.mockResolvedValue({ subject: 'Xari Bulbul: qəbul', html: '<p>Salam</p>', text: 'Salam' });
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.click(screen.getByRole('button', { name: COPY.preview }));

    expect(previewMock).toHaveBeenCalledWith('PLEDGE_CONFIRMED', {
      locale: 'az',
      subject: '{1} kampaniyasına dəstəyiniz təsdiqləndi',
      body: '{1} kampaniyasına {2} məbləğində dəstəyiniz təsdiqləndi.',
    });
    const frame = await screen.findByTitle(COPY.previewFrameTitle);
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('srcdoc', '<p>Salam</p>');
    expect(screen.getByText(fillPlaceholders(COPY.previewSubject, { subject: 'Xari Bulbul: qəbul' }))).toBeInTheDocument();

    await user.type(field(COPY.bodyLabel), '!');
    expect(screen.getByText(COPY.previewStale)).toBeInTheDocument();
  });

  it('sends the unsaved text to the caller, and words a relay that refused it', async () => {
    const user = userEvent.setup();
    testSendMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(502, { code: 'MAIL_RELAY_UNAVAILABLE' }));
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi'));

    await user.click(screen.getByRole('button', { name: COPY.testSend }));
    expect(await screen.findByText(COPY.testSent)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: COPY.testSend }));
    expect(await screen.findByText(COPY.errors['MAIL_RELAY_UNAVAILABLE'] ?? '')).toBeInTheDocument();
  });

  it('asks before going back to the shipped copy', async () => {
    const user = userEvent.setup();
    draftMock.mockResolvedValue(shipped({ override: version({ version: 3 }) }));
    withdrawMock.mockResolvedValue(undefined);
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await waitFor(() => expect(field(COPY.subjectLabel)).toHaveValue('{1}: qəbul olundu'));

    await user.click(screen.getByRole('button', { name: COPY.withdraw }));
    expect(withdrawMock).not.toHaveBeenCalled();
    const asked = screen.getByRole('group', { name: COPY.confirmWithdrawLabel });
    await user.click(within(asked).getByRole('button', { name: COPY.withdraw }));

    expect(withdrawMock).toHaveBeenCalledWith('PLEDGE_CONFIRMED', 'az');
    expect(await screen.findByText(COPY.savedWithdrawn)).toBeInTheDocument();
    expect(field(COPY.subjectLabel)).toHaveValue('{1} kampaniyasına dəstəyiniz təsdiqləndi');
  });
});

describe('the history', () => {
  it('dates each version in Baku, names its author, shows its text and can restore it', async () => {
    const user = userEvent.setup();
    const older = version({ id: 'e7a00000-0000-4000-8000-000000000002', version: 1, live: false, subject: 'Köhnə', body: '{1}: {2} köhnə.' });
    const live = version({ id: 'e7a00000-0000-4000-8000-000000000003', version: 2, live: true });
    draftMock.mockResolvedValue(shipped({ override: live }));
    historyMock.mockResolvedValue({ versions: [live, older] });
    editMock.mockResolvedValue(version({ id: 'e7a00000-0000-4000-8000-000000000004', version: 3, subject: 'Köhnə', body: '{1}: {2} köhnə.' }));
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);

    expect(
      await screen.findByText(fillPlaceholders(COPY.versionLine, { version: '1', date: bakuDateTime(older.createdAt ?? '', 'en') })),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Kamran Əliyev')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(COPY.showText)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: COPY.restore }));
    const asked = screen.getByRole('group', { name: COPY.confirmRestoreLabel });
    expect(within(asked).getByText(fillPlaceholders(COPY.confirmRestore, { from: '1', version: '3' }))).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: COPY.restore }));

    expect(editMock).toHaveBeenCalledWith(
      'PLEDGE_CONFIRMED',
      'az',
      'Köhnə',
      '{1}: {2} köhnə.',
      fillPlaceholders(COPY.restoredNote, { version: '1' }),
    );
  });

  it('says so when the history could not be read', async () => {
    historyMock.mockRejectedValue(new ApiError(500, { detail: 'Internal Server Error' }));
    render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);

    // A failure on the service's side is worded as one, in the reader's language.
    expect(await screen.findByText(COPY.refusals.serviceFailed ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    draftMock.mockResolvedValue(shipped({ override: version({ version: 2 }) }));
    historyMock.mockResolvedValue({ versions: [version({ version: 2 })] });
    const { container } = render(<EmailTemplateEditor type="PLEDGE_CONFIRMED" copy={COPY} />);
    await screen.findByText(COPY.overriddenTitle);

    await expectNoViolations(container);
  });
});
