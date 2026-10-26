import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import { RevisionNotice } from './revision-notice';
import { editorChromeCopyFrom } from '@ideanest/campaign-editor/copy';
import { editorTranslators } from './translator';

const mockSubmit = jest.fn();
const mockDiscard = jest.fn();
const mockFetch = jest.fn();
jest.mock('./api', () => ({
  submitRevision: (...args: unknown[]) => mockSubmit(...args),
  discardRevision: (...args: unknown[]) => mockDiscard(...args),
  fetchProjectEdit: (...args: unknown[]) => mockFetch(...args),
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 740 },
  insets: { top: 24, left: 0, right: 0, bottom: 16 },
};

const { t, counter, locale } = editorTranslators('en');
const copy = editorChromeCopyFrom(t, counter, locale).revision;
const WORDS = en.campaignEditor.revision;

function project(extra: Partial<ProjectEdit> = {}): ProjectEdit {
  return {
    id: 'p1',
    slug: 'solar-lamp',
    state: 'LIVE',
    title: 'Solar Lamp',
    lockedFields: [],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  } as ProjectEdit;
}

const DRAFT = project({
  revision: {
    id: 'r1',
    status: 'DRAFT',
    changedFields: ['title', 'story'],
    submittedAt: null,
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
});
const PENDING = project({
  revision: {
    id: 'r1',
    status: 'PENDING',
    changedFields: ['title'],
    submittedAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
});
const REJECTED = project({
  rejectedRevision: { id: 'r0', reason: 'The cover shows a logo we cannot verify.', decidedAt: '2026-10-03T10:00:00.000Z' },
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const onDiscarded = jest.fn();
let latest: ProjectEdit;

function Harness({ first, readOnly = false }: { first: ProjectEdit; readOnly?: boolean }) {
  const [current, setCurrent] = useState(first);
  latest = current;
  return (
    <RevisionNotice
      projectId="p1"
      project={current}
      copy={copy}
      readOnly={readOnly}
      onProject={setCurrent}
      onDiscarded={onDiscarded}
    />
  );
}

async function show(first: ProjectEdit, readOnly = false) {
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        <Harness first={first} readOnly={readOnly} />
      </IntlProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
});

function refusal(reason: string): ApiError {
  return new ApiError(409, { status: 409, code: 'REVISION_NOT_AVAILABLE', meta: { reason } } as never);
}

describe('RevisionNotice', () => {
  it('draws nothing when nothing is held', async () => {
    await show(project());
    expect(screen.queryByTestId('revision-notice')).toBeNull();
  });

  it('says a draft is not public, names the changed sections and offers both actions', async () => {
    await show(DRAFT);
    expect(screen.getByText(WORDS.draftTitle)).toBeTruthy();
    expect(screen.getByText(WORDS.draftBody)).toBeTruthy();
    expect(screen.getByTestId('revision-changed')).toHaveTextContent(`${WORDS.changedHeading}: ${WORDS.fields.title}, ${WORDS.fields.story}`);
    expect(screen.getByLabelText(WORDS.submit)).toBeTruthy();
    expect(screen.getByLabelText(WORDS.discard)).toBeTruthy();
  });

  it('names a reward-only edit as Rewards, not as the raw field name', async () => {
    await show(project({ revision: { ...DRAFT.revision!, changedFields: ['rewards'] } }));
    expect(screen.getByTestId('revision-changed')).toHaveTextContent(`${WORDS.changedHeading}: ${en.mobile.editor.rewards.revisionField}`);
    expect(screen.getByLabelText(WORDS.submit)).toBeTruthy();
  });

  it('names held items and shipping zones in words, not as the raw field names (#587)', async () => {
    await show(project({ revision: { ...DRAFT.revision!, changedFields: ['items', 'shippingZones'] } }));
    // The shared copy's words win once it names these sections; until then the app's own do.
    const shared = WORDS.fields as Record<string, string | undefined>;
    const own = en.mobile.editor.rewards.heldItem;
    const items = shared.items ?? own.revisionItemsField;
    const zones = shared.shippingZones ?? own.revisionShippingZonesField;
    expect(screen.getByTestId('revision-changed')).toHaveTextContent(`${WORDS.changedHeading}: ${items}, ${zones}`);
    expect(screen.getByLabelText(WORDS.submit)).toBeTruthy();
  });

  it('says a pending edit is with a moderator, and still lets it be sent back to nothing', async () => {
    await show(PENDING);
    expect(screen.getByText(WORDS.pendingTitle)).toBeTruthy();
    expect(screen.getByTestId('revision-submit').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('revision-discard').props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it('shows the moderator’s reason for a rejected edit and no actions', async () => {
    await show(REJECTED);
    expect(screen.getByText(WORDS.rejectedTitle)).toBeTruthy();
    expect(screen.getByTestId('revision-reason')).toHaveTextContent(`${WORDS.reasonLabel}: The cover shows a logo we cannot verify.`);
    expect(screen.queryByTestId('revision-submit')).toBeNull();
    expect(screen.queryByTestId('revision-discard')).toBeNull();
  });

  it('sends the edit for review and takes the answer', async () => {
    mockSubmit.mockResolvedValueOnce(PENDING);
    await show(DRAFT);
    await fireEvent.press(screen.getByTestId('revision-submit'));
    await settle();
    expect(mockSubmit).toHaveBeenCalledWith('p1');
    expect(screen.getByText(WORDS.pendingTitle)).toBeTruthy();
  });

  it('asks before discarding, keeps the edit on Keep editing, and re-seeds after a discard', async () => {
    mockDiscard.mockResolvedValueOnce(project());
    await show(DRAFT);
    await fireEvent.press(screen.getByTestId('revision-discard'));
    expect(screen.getByText(WORDS.confirmDiscardTitle)).toBeTruthy();
    expect(mockDiscard).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('revision-discard-dialog-keep'));
    await settle();
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(screen.getByText(WORDS.draftTitle)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('revision-discard'));
    await fireEvent.press(screen.getByTestId('revision-discard-dialog-delete'));
    await settle();
    expect(mockDiscard).toHaveBeenCalledWith('p1');
    expect(onDiscarded).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('revision-notice')).toBeNull();
  });

  it.each([
    ['NO_OPEN_REVISION', WORDS.refusals.NO_OPEN_REVISION],
    ['ALREADY_SUBMITTED', WORDS.refusals.ALREADY_SUBMITTED],
    ['NO_CHANGES', WORDS.refusals.NO_CHANGES],
    ['NOT_PENDING', WORDS.refusals.NOT_PENDING],
    ['SOMETHING_NEW', WORDS.refusals.UNKNOWN],
  ])('words the %s refusal and reads the project again', async (reason, sentence) => {
    mockSubmit.mockRejectedValueOnce(refusal(reason));
    mockFetch.mockResolvedValueOnce(PENDING);
    await show(DRAFT);
    await fireEvent.press(screen.getByTestId('revision-submit'));
    await settle();
    expect(screen.getByText(WORDS.refusedTitle)).toBeTruthy();
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('p1');
    expect(latest.revision?.status).toBe('PENDING');
  });

  it('says the changes went back to draft when a pending edit is edited again', async () => {
    let set: (next: ProjectEdit) => void = () => {};
    function Wrapper() {
      const [current, setCurrent] = useState(PENDING);
      set = setCurrent;
      return (
        <RevisionNotice
          projectId="p1"
          project={current}
          copy={copy}
          readOnly={false}
          onProject={setCurrent}
          onDiscarded={onDiscarded}
        />
      );
    }
    await act(async () => setLocale('en'));
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <IntlProvider locale="en" messages={en}>
          <Wrapper />
        </IntlProvider>
      </SafeAreaProvider>,
    );
    await settle();
    expect(screen.queryByTestId('revision-returned')).toBeNull();
    await act(async () => set(DRAFT));
    expect(screen.getByTestId('revision-returned')).toHaveTextContent(WORDS.returnedToDraft);
  });

  it('blocks both actions while offline', async () => {
    await show(DRAFT, true);
    expect(screen.getByTestId('revision-submit').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('revision-discard').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('wraps long labels instead of cutting them, at the largest system font', async () => {
    await show(DRAFT);
    const label = screen.getByText(WORDS.submit, { includeHiddenElements: true });
    expect(label.props.numberOfLines).toBeUndefined();
  });
});
