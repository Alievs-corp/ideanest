import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Image } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit, StoryVersionSummary } from '@ideanest/campaign-editor/contract';
import { parseSpans, toggleMark, type StoryBlock, type StoryDocument } from '@ideanest/campaign-editor/story';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { memoryStore } from '../../../lib/storage';
import { EditorProvider } from '../editor-context';
import { StoryPanel } from './story-panel';

jest.mock('../../../lib/use-session', () => ({ useSession: () => ({ signedIn: true, locked: false, unlocked: false }) }));
let mockProject: () => Promise<unknown> = async () => ({});
let mockVersions: () => Promise<unknown> = async () => [];
let mockVersion: (number: number) => Promise<unknown> = async () => ({});
jest.mock('../../../api/client', () => ({
  api: () => ({
    get: (path: string, options?: { path?: { number?: number } }) => {
      if (path === '/v1/projects/{id}/story/versions') return mockVersions();
      if (path === '/v1/projects/{id}/story/versions/{number}') return mockVersion(options?.path?.number ?? 0);
      return mockProject();
    },
  }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
const mockSend = jest.fn();
jest.mock('../../../lib/media/upload', () => {
  const actual = jest.requireActual('../../../lib/media/upload');
  return { ...actual, uploadImage: jest.fn() };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const STORY = en.campaignEditor.story;
const MOBILE = en.mobile.editor.story;

function doc(blocks: readonly StoryBlock[]): StoryDocument {
  return { version: 1, blocks };
}

const BLOCKS: readonly StoryBlock[] = [
  { type: 'heading', level: 2, id: 'the-plan', text: 'The plan' },
  { type: 'paragraph', spans: parseSpans('We build **lamps** for night markets.') },
  { type: 'heading', level: 3, id: 'parts', text: 'Parts' },
];

function project(extra: Partial<ProjectEdit> = {}): ProjectEdit {
  return {
    id: 'p1',
    slug: 'solar-lamp',
    state: 'DRAFT',
    title: 'Solar Lamp',
    blurb: 'A lamp.',
    categoryId: 'c1',
    subcategoryId: null,
    goal: { amount: '5000.00', currency: 'AZN' },
    durationDays: 30,
    latePledgeEnabled: false,
    lockedFields: [],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    story: doc(BLOCKS),
    risks: 'Shipping could slip.',
    ...extra,
  } as ProjectEdit;
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorProvider projectId="p1" store={memoryStore()}>
            <StoryPanel />
          </EditorProvider>
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const sent = (method: string) => mockSend.mock.calls.filter((call) => call[0] === method);
const patches = () => sent('PATCH').map((call) => call[2] as Record<string, unknown>);
const storyPatches = () => patches().filter((patch) => 'story' in patch).map((patch) => patch.story as StoryDocument);
const blur = async (testID: string) => {
  await fireEvent(screen.getByTestId(testID), 'blur');
  await settle();
};
const announced = () =>
  (AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock).mock.calls.map((call) => call[0] as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockSend.mockImplementation(async () => project());
  mockProject = async () => project();
  mockVersions = async () => [];
  setOnline(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
});

describe('StoryPanel — loading and the document', () => {
  it('shows three named label-and-block placeholders while the project loads', async () => {
    mockProject = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('story-loading').props.accessibilityLabel).toBe(STORY.panel.loadingLabel);
  });

  it('draws every block as a card with its kind and position, the count, and the anchor menu', async () => {
    await show();
    expect(within(screen.getByTestId('story-block-1')).getByText('Paragraph · 2 of 3')).toBeTruthy();
    expect(screen.getByTestId('story-block-1-text').props.value).toBe('We build **lamps** for night markets.');
    expect(screen.getByTestId('story-risks').props.value).toBe('Shipping could slip.');
    expect(screen.getByTestId('story-characters')).toHaveTextContent('46 of 500 characters needed to submit');

    const anchors = screen.getByTestId('story-anchors');
    expect(within(anchors).getByText('#the-plan')).toBeTruthy();
    expect(within(anchors).getByText('#parts')).toBeTruthy();
  });

  it('shows the empty-story card when there are no blocks', async () => {
    mockProject = async () => project({ story: null });
    await show();
    expect(within(screen.getByTestId('story-empty')).getByText(STORY.blocks.empty)).toBeTruthy();
    expect(screen.queryByTestId('story-anchors')).toBeNull();
  });

  it('names every icon-only control with the block’s kind and position', async () => {
    await show();
    const paragraph = 'Paragraph 2 of 3: We build **lamps** for night markets.';
    expect(screen.getByTestId('story-block-1-up').props.accessibilityLabel).toBe(`Move ${paragraph} up`);
    expect(screen.getByTestId('story-block-1-down').props.accessibilityLabel).toBe(`Move ${paragraph} down`);
    expect(screen.getByTestId('story-block-1-remove').props.accessibilityLabel).toBe(`Remove ${paragraph}`);
    // Disabled, not removed, at the ends.
    expect(screen.getByTestId('story-block-0-up').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('story-block-1-text-marks-bold').props.accessibilityLabel).toBe(STORY.toolbar.bold);
    expect(screen.getByTestId('story-block-1-text-marks-italic').props.accessibilityLabel).toBe(STORY.toolbar.italic);
  });
});

describe('StoryPanel — the marks', () => {
  it('makes a selection bold exactly as the shared toggleMark does, restores the selection, and saves the spans', async () => {
    mockProject = async () => project({ story: doc([{ type: 'paragraph', spans: parseSpans('Solar lamps for markets') }]) });
    await show();
    const field = screen.getByTestId('story-block-0-text');
    await fireEvent(field, 'selectionChange', { nativeEvent: { selection: { start: 6, end: 11 } } });

    const bold = screen.getByTestId('story-block-0-text-marks-bold');
    expect(bold.props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(bold);
    const expected = toggleMark('Solar lamps for markets', 6, 11, 'strong');
    expect(screen.getByTestId('story-block-0-text').props.value).toBe(expected.text);
    expect(screen.getByTestId('story-block-0-text').props.value).toBe('Solar **lamps** for markets');
    expect(screen.getByTestId('story-block-0-text').props.selection).toEqual({
      start: expected.selectionStart,
      end: expected.selectionEnd,
    });
    expect(screen.getByTestId('story-block-0-text-marks-bold').props.accessibilityState).toMatchObject({ selected: true });

    await blur('story-block-0-text');
    expect(storyPatches()).toEqual([doc([{ type: 'paragraph', spans: parseSpans(expected.text) }])]);
  });

  it('italic on the same words nests inside the bold, as on the web', async () => {
    mockProject = async () => project({ story: doc([{ type: 'paragraph', spans: parseSpans('Solar **lamps** here') }]) });
    await show();
    const start = 'Solar **'.length;
    await fireEvent(screen.getByTestId('story-block-0-text'), 'selectionChange', {
      nativeEvent: { selection: { start, end: start + 5 } },
    });
    await fireEvent.press(screen.getByTestId('story-block-0-text-marks-italic'));
    expect(screen.getByTestId('story-block-0-text').props.value).toBe(
      toggleMark('Solar **lamps** here', start, start + 5, 'em').text,
    );
  });
});

describe('StoryPanel — saving', () => {
  it('sends the whole story after a change, on blur', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'We build *lamps*.');
    await blur('story-block-1-text');
    expect(storyPatches()).toHaveLength(1);
    expect(storyPatches()[0]?.blocks[1]).toEqual({ type: 'paragraph', spans: parseSpans('We build *lamps*.') });
  });

  it('an incomplete block pauses saving and says so; saving resumes once it is filled in', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('story-add-embed'));
    await settle();
    expect(screen.getByTestId('story-not-saving')).toBeTruthy();
    expect(within(screen.getByTestId('story-block-3')).getByText(STORY.vocabulary.problems.embedNeedsUrl)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'Changed while incomplete.');
    await blur('story-block-1-text');
    expect(storyPatches()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('story-block-3-url'), 'https://youtu.be/abc');
    await fireEvent.changeText(screen.getByTestId('story-block-3-title'), 'The lamp at night');
    await blur('story-block-3-title');
    expect(screen.queryByTestId('story-not-saving')).toBeNull();
    expect(storyPatches()).toHaveLength(1);
    expect(storyPatches()[0]?.blocks[3]).toEqual({
      type: 'embed',
      provider: 'youtube',
      url: 'https://youtu.be/abc',
      title: 'The lamp at night',
    });
  });

  it('STORY_DOCUMENT_INVALID at blocks[2] marks the third block with the server’s words', async () => {
    mockSend.mockRejectedValueOnce(
      new ApiError(422, {
        status: 422,
        code: 'STORY_DOCUMENT_INVALID',
        detail: 'The story was refused.',
        errors: { story: 'That anchor is reserved.' },
        meta: { path: 'blocks[2].id' },
      }),
    );
    await show();
    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'Edited.');
    await blur('story-block-1-text');

    expect(within(screen.getByTestId('story-not-saved')).getByText('The story was refused.')).toBeTruthy();
    expect(within(screen.getByTestId('story-block-2')).getByText('That anchor is reserved.')).toBeTruthy();
    expect(screen.queryByTestId('story-block-1-problem')).toBeNull();
  });

  it('sends risks as written, and an emptied field as null', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('story-risks'), 'Tooling may be late.');
    await blur('story-risks');
    await fireEvent.changeText(screen.getByTestId('story-risks'), '   ');
    await blur('story-risks');
    expect(patches()).toEqual([{ risks: 'Tooling may be late.' }, { risks: null }]);
  });

  it('a heading renamed keeps an anchor that is not its text’s own', async () => {
    mockProject = async () =>
      project({ story: doc([{ type: 'heading', level: 2, id: 'faq', text: 'Questions' }]) });
    await show();
    await fireEvent.changeText(screen.getByTestId('story-block-0-heading'), 'Your questions');
    await blur('story-block-0-heading');
    expect(storyPatches()[0]?.blocks[0]).toEqual({ type: 'heading', level: 2, id: 'faq', text: 'Your questions' });
  });
});

describe('StoryPanel — adding, moving and removing blocks', () => {
  it('appends a paragraph, focuses it, and announces it', async () => {
    mockProject = async () => project({ story: doc(BLOCKS.slice(0, 2)) });
    await show();
    await fireEvent.press(screen.getByTestId('story-add-paragraph'));
    await settle();
    expect(screen.getByTestId('story-block-2-text').props.autoFocus).toBe(true);
    expect(announced()).toContain('Paragraph added as block 3 of 3.');
    expect(storyPatches().at(-1)?.blocks).toHaveLength(3);
  });

  it('names the seven add pills as actions', async () => {
    await show();
    for (const type of ['paragraph', 'heading', 'list', 'quote', 'image', 'embed', 'rule'] as const) {
      expect(screen.getByTestId(`story-add-${type}`)).toBeTruthy();
    }
    expect(screen.getByTestId('story-add-paragraph').props.accessibilityLabel).toBe(
      `Add paragraph. ${STORY.blocks.hints.paragraph}`,
    );
    expect(screen.getByTestId('story-add-image').props.accessibilityLabel).toBe(`Add image. ${MOBILE.imageHint}`);
  });

  it('moves a block down at once, sends the new order, and announces where it went', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('story-block-0-down'));
    await settle();
    expect(screen.getByTestId('story-block-1-heading').props.value).toBe('The plan');
    expect(storyPatches()[0]?.blocks.map((block) => block.type)).toEqual(['paragraph', 'heading', 'heading']);
    expect(announced()).toContain('Heading moved to 2 of 3.');
  });

  it('runs the screen reader’s move and delete actions from the card’s name', async () => {
    await show();
    const head = screen.getByTestId('story-block-2-head');
    expect(head.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['moveUp', 'delete']);
    await fireEvent(head, 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    await settle();
    expect(screen.getByTestId('story-block-1-heading').props.value).toBe('Parts');

    await fireEvent(screen.getByTestId('story-block-0-head'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    await settle();
    expect(screen.queryByTestId('story-block-2')).toBeNull();
    expect(announced()).toContain('Heading removed. 2 blocks left.');
  });

  it('a list keeps its last item', async () => {
    mockProject = async () => project({ story: doc([{ type: 'list', ordered: false, items: [parseSpans('One')] }]) });
    await show();
    expect(screen.getByTestId('story-block-0-item-0-remove').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('story-block-0-add-item'));
    await fireEvent.changeText(screen.getByTestId('story-block-0-item-1'), 'Two');
    await blur('story-block-0-item-1');
    expect(storyPatches().at(-1)?.blocks[0]).toEqual({
      type: 'list',
      ordered: false,
      items: [parseSpans('One'), parseSpans('Two')],
    });
    expect(screen.getByTestId('story-block-0-item-0-remove').props.accessibilityLabel).toBe(
      'Remove item 1 of 2 in Bulleted list 1 of 1, 2 items',
    );
  });

  it('an image is measured from an address, shown as W×H pixels, and saved once it has a description', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_url, success) => success(1600, 900));
    mockProject = async () => project({ story: doc([]) });
    await show();
    await fireEvent.press(screen.getByTestId('story-add-image'));
    await settle();
    await fireEvent.press(screen.getByTestId('story-block-0-source-address-open'));
    await fireEvent.changeText(screen.getByTestId('story-block-0-source-address'), 'https://images.example.com/a.jpg');
    await fireEvent.press(screen.getByTestId('story-block-0-source-address-use'));
    await settle();
    expect(screen.getByTestId('story-block-0-size')).toHaveTextContent('1600×900 pixels');
    expect(within(screen.getByTestId('story-block-0')).getByText(STORY.vocabulary.problems.imageNeedsAlt)).toBeTruthy();
    expect(storyPatches()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('story-block-0-alt'), 'The lamp on a stall');
    await blur('story-block-0-alt');
    expect(storyPatches().at(-1)?.blocks[0]).toEqual({
      type: 'image',
      url: 'https://images.example.com/a.jpg',
      width: 1600,
      height: 900,
      alt: 'The lamp on a stall',
    });
  });
});

describe('StoryPanel — read-only states', () => {
  it('a story in a newer format is read-only, offers Reload, and is never autosaved', async () => {
    mockProject = async () => project({ story: { version: 99, blocks: [] } as unknown as StoryDocument });
    await show();
    expect(screen.getByText(STORY.panel.readOnlyTitle)).toBeTruthy();
    expect(screen.getByText(MOBILE.unreadableDetail)).toBeTruthy();
    expect(screen.queryByTestId('story-panel')).toBeNull();
    expect(screen.queryByTestId('story-risks')).toBeNull();
    await fireEvent.press(screen.getByTestId('story-reload'));
    await settle();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('Reload re-seeds the tab from the service’s newer copy', async () => {
    mockProject = async () => project({ story: { version: 99, blocks: [] } as unknown as StoryDocument });
    await show();
    mockProject = async () => project();
    await fireEvent.press(screen.getByTestId('story-reload'));
    await settle();
    expect(screen.queryByTestId('story-unreadable')).toBeNull();
    expect(screen.getByTestId('story-block-1-text').props.value).toBe('We build **lamps** for night markets.');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('offline, every field and the add row are disabled and nothing is sent', async () => {
    await show();
    await act(async () => setOnline(false));
    expect(screen.getByTestId('story-block-1-text').props.editable).toBe(false);
    expect(screen.getByTestId('story-risks').props.editable).toBe(false);
    expect(screen.getByTestId('story-add-paragraph').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'Offline');
    await blur('story-block-1-text');
    expect(patches()).toEqual([]);
  });
});

describe('StoryPanel — earlier versions', () => {
  const VERSIONS: readonly StoryVersionSummary[] = [
    { number: 7, createdAt: '2026-10-05T09:30:00.000Z', authorId: 'u1', characters: 1240 },
    { number: 6, createdAt: '2026-10-04T09:30:00.000Z', authorId: 'u1', characters: 300 },
  ];

  it('lists the versions, newest named as such, and previews one as labelled text', async () => {
    mockVersions = async () => VERSIONS;
    mockVersion = async (number) => ({
      ...VERSIONS[1],
      number,
      document: doc([{ type: 'paragraph', spans: parseSpans('An older opening.') }, { type: 'rule' }]),
    });
    await show();
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();

    const newest = screen.getByTestId('story-version-7');
    expect(within(newest).getByText(/Version 7/)).toBeTruthy();
    expect(within(newest).getByText(/most recent/)).toBeTruthy();
    expect(within(newest).getByText(/1,240 characters/)).toBeTruthy();
    expect(within(screen.getByTestId('story-version-6')).queryByText(/most recent/)).toBeNull();

    await fireEvent.press(screen.getByTestId('story-version-6-preview'));
    await settle();
    const content = screen.getByTestId('story-version-6-content');
    expect(within(content).getByText('Paragraph: An older opening.')).toBeTruthy();
    expect(within(content).getByText('Divider')).toBeTruthy();
    expect(screen.getByTestId('story-version-6-preview').props.accessibilityLabel).toBe('Hide version 6');
  });

  it('restores only after confirmation, then re-seeds the editor from the server’s answer', async () => {
    mockVersions = async () => VERSIONS;
    const restored = doc([{ type: 'paragraph', spans: parseSpans('The restored story.') }]);
    mockSend.mockImplementation(async (method: string) =>
      method === 'POST' ? project({ story: restored }) : project(),
    );
    await show();
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    await fireEvent.press(screen.getByTestId('story-version-6-restore'));
    await settle();

    expect(screen.getByText('Restore version 6?')).toBeTruthy();
    expect(screen.getByText(/The story you have now holds 46 characters/)).toBeTruthy();
    expect(sent('POST')).toEqual([]);
    await fireEvent.press(screen.getByTestId('story-restore-keep'));
    await settle();
    expect(sent('POST')).toEqual([]);

    await fireEvent.press(screen.getByTestId('story-version-6-restore'));
    await settle();
    await fireEvent.press(screen.getByTestId('story-restore-confirm'));
    await settle();
    expect(sent('POST').map((call) => call[1])).toEqual(['/v1/projects/p1/story/versions/6/restore']);
    expect(screen.getByTestId('story-block-0-text').props.value).toBe('The restored story.');
    expect(screen.queryByTestId('story-block-1')).toBeNull();
  });

  it('says when there are no earlier versions', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    expect(within(screen.getByTestId('story-history-empty')).getByText(STORY.history.emptyTitle)).toBeTruthy();
  });

  it('a failed history load says so and tries again', async () => {
    let calls = 0;
    mockVersions = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Network request failed');
      return VERSIONS;
    };
    await show();
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    expect(within(screen.getByTestId('story-history-failed')).getByText(STORY.history.failedTitle)).toBeTruthy();
    expect(screen.getByText(MOBILE.history.unreachable)).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId('story-history-failed')).getByRole('button'));
    await settle();
    expect(screen.getByTestId('story-version-7')).toBeTruthy();
  });
});
