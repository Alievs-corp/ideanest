import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Image, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit, StoryVersionSummary } from '@ideanest/campaign-editor/contract';
import { parseSpans, toggleMark, type StoryBlock, type StoryDocument } from '@ideanest/campaign-editor/story';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import * as ImagePicker from 'expo-image-picker';
import { uploadImage } from '../../../lib/media/upload';
import { memoryStore, type KeyValueStore } from '../../../lib/storage';
import { heldKeyFor, readUnsent, unsentKeyFor, writeUnsent } from '../../../lib/unsent-edits';
import { EditorProvider } from '../editor-context';
import { storyFingerprint, writeHeldStory } from './held-story';
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

// The system font scale: the owner's phone runs at 1.4.
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

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

function tree(client: QueryClient, store: KeyValueStore, tabShown: boolean) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorProvider projectId="p1" store={store}>
            {/* The frame's Slot: leaving the tab unmounts it, the editor stays. */}
            {tabShown ? <StoryPanel /> : null}
          </EditorProvider>
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

async function show({ store = memoryStore() }: { store?: KeyValueStore } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => setLocale('en'));
  const view = await render(tree(client, store, true));
  await settle();
  return {
    store,
    client,
    /** Another tab opens: the Story route unmounts, the editor (and its autosave) stays. */
    leaveTab: async () => {
      await view.rerender(tree(client, store, false));
      await settle();
    },
    returnToTab: async () => {
      await view.rerender(tree(client, store, true));
      await settle();
    },
  };
}

/** Real time, for the debounced writes and the focus delay. */
async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const heldKey = heldKeyFor('p1', 'story');

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
  mockFontScale = 1;
  jest.clearAllMocks();
  mockSend.mockReset();
  mockSend.mockImplementation(async () => project());
  mockProject = async () => project();
  mockVersions = async () => [];
  setOnline(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  picker.__reset();
  upload.mockReset();
});

const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};
const upload = jest.mocked(uploadImage);

/** A story with an embed block that has an address and no title yet: held back, never sent. */
async function holdAnEmbed() {
  await fireEvent.press(screen.getByTestId('story-add-embed'));
  await settle();
  await fireEvent.changeText(screen.getByTestId('story-block-3-url'), 'https://youtu.be/held');
  await blur('story-block-3-url');
}

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

describe('StoryPanel — a held story', () => {
  it('survives leaving the tab and coming back, and is never sent while incomplete', async () => {
    const editor = await show();
    await holdAnEmbed();
    await editor.leaveTab();
    expect(screen.queryByTestId('story-panel')).toBeNull();
    await editor.returnToTab();
    expect(screen.getByTestId('story-block-3-url').props.value).toBe('https://youtu.be/held');
    expect(screen.getByTestId('story-not-saving')).toBeTruthy();
    expect(storyPatches()).toEqual([]);
  });

  it('survives the app being killed, then is saved and forgotten once complete', async () => {
    const store = memoryStore();
    await show({ store });
    await holdAnEmbed();
    await wait(500); // the held story is written after a pause in typing
    expect(store.getString(heldKey)).toBeDefined();

    // A new launch: nothing of the first one ran its cleanup.
    await show({ store });
    expect(screen.getByTestId('story-block-3-url').props.value).toBe('https://youtu.be/held');
    expect(screen.queryByTestId('story-changed-elsewhere')).toBeNull();
    expect(storyPatches()).toEqual([]);

    await fireEvent.changeText(screen.getByTestId('story-block-3-title'), 'The lamp at night');
    await blur('story-block-3-title');
    expect(storyPatches().at(-1)?.blocks[3]).toEqual({
      type: 'embed',
      provider: 'youtube',
      url: 'https://youtu.be/held',
      title: 'The lamp at night',
    });
    expect(store.getString(heldKey)).toBeUndefined();
  });

  it('says so when the service’s story changed meanwhile, and the creator chooses', async () => {
    const store = memoryStore();
    const held = doc([...BLOCKS, { type: 'embed', provider: 'youtube', url: '', title: '' }]);
    writeHeldStory(store, 'p1', { document: held, base: storyFingerprint(doc([])), at: '2026-10-07T08:00:00.000Z' });
    await show({ store });
    expect(screen.getByTestId('story-changed-elsewhere')).toBeTruthy();
    expect(screen.getByTestId('story-block-3')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('story-held-discard'));
    await settle();
    expect(screen.queryByTestId('story-block-3')).toBeNull();
    expect(screen.queryByTestId('story-changed-elsewhere')).toBeNull();
    expect(store.getString(heldKey)).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('keeping this phone’s version stops the warning and keeps the draft', async () => {
    const store = memoryStore();
    const held = doc([...BLOCKS, { type: 'embed', provider: 'youtube', url: '', title: '' }]);
    writeHeldStory(store, 'p1', { document: held, base: storyFingerprint(doc([])), at: '2026-10-07T08:00:00.000Z' });
    await show({ store });
    await fireEvent.press(screen.getByTestId('story-held-keep'));
    await settle();
    expect(screen.queryByTestId('story-changed-elsewhere')).toBeNull();
    expect(screen.getByTestId('story-block-3')).toBeTruthy();
    await show({ store });
    expect(screen.queryByTestId('story-changed-elsewhere')).toBeNull();
  });

  it('a newer read in a format this build cannot read turns the tab read-only, held story or not', async () => {
    const editor = await show();
    await holdAnEmbed();
    mockProject = async () => project({ story: { version: 99, blocks: [] } as unknown as StoryDocument });
    await act(async () => {
      await editor.client.refetchQueries();
    });
    await settle();
    expect(screen.getByTestId('story-unreadable')).toBeTruthy();
    expect(storyPatches()).toEqual([]);
  });

  it('the restore confirmation says the held changes are discarded, not kept', async () => {
    mockVersions = async () => [{ number: 6, createdAt: '2026-10-04T09:30:00.000Z', authorId: 'u1', characters: 300 }];
    mockSend.mockImplementation(async (method: string) =>
      method === 'POST' ? project({ story: doc([{ type: 'paragraph', spans: parseSpans('Restored.') }]) }) : project(),
    );
    const editor = await show();
    await holdAnEmbed();
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    await fireEvent.press(screen.getByTestId('story-version-6-restore'));
    await settle();
    expect(screen.getByTestId('story-restore-current')).toHaveTextContent(MOBILE.history.discardsHeld);

    await fireEvent.press(screen.getByTestId('story-restore-confirm'));
    await settle();
    await wait(500);
    expect(screen.getByTestId('story-block-0-text').props.value).toBe('Restored.');
    expect(editor.store.getString(heldKey)).toBeUndefined();
  });
});

describe('StoryPanel — restoring while a change is on its way', () => {
  const VERSIONS: readonly StoryVersionSummary[] = [
    { number: 6, createdAt: '2026-10-04T09:30:00.000Z', authorId: 'u1', characters: 300 },
  ];

  it('waits for a change in the air, and allows it once the answer has landed', async () => {
    mockVersions = async () => VERSIONS;
    let answer: (value: unknown) => void = () => {};
    mockSend.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await show();
    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'Typed just now.');
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    expect(screen.getByTestId('story-history-waiting')).toHaveTextContent(MOBILE.history.waitForSave);
    expect(screen.getByTestId('story-version-6-restore').props.accessibilityState).toMatchObject({ disabled: true });

    await act(async () => answer(project()));
    await settle();
    expect(screen.queryByTestId('story-history-waiting')).toBeNull();
    expect(screen.getByTestId('story-version-6-restore').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('waits while a refused story is kept for the retry', async () => {
    mockVersions = async () => VERSIONS;
    mockSend.mockRejectedValueOnce(new ApiError(500, { status: 500 }));
    await show();
    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'Refused.');
    await blur('story-block-1-text');
    expect(screen.getByTestId('story-not-saved')).toBeTruthy();
    mockSend.mockImplementation(() => new Promise(() => {}));
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    expect(screen.getByTestId('story-history-waiting')).toBeTruthy();
    expect(screen.getByTestId('story-version-6-restore').props.accessibilityState).toMatchObject({ disabled: true });
    expect(sent('POST')).toEqual([]);
  });
});

describe('StoryPanel — focus, pickers, uploads and the refusal mark', () => {
  it('returns focus to the moved card’s button once, and not on later keystrokes', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('story-block-0-down'));
    await wait(200);
    const focused = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls;
    expect(focused).toHaveLength(1);
    expect(focused[0]?.[1]).toBe('focus');

    await fireEvent.changeText(screen.getByTestId('story-block-0-text'), 'Typing after the move.');
    await wait(200);
    await fireEvent.changeText(screen.getByTestId('story-block-0-text'), 'Typing again.');
    await wait(200);
    expect(jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls).toHaveLength(1);
  });

  it('a heading’s level is chosen from the picker and saved at once', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('story-block-0-level'));
    await fireEvent.press(screen.getByRole('radio', { name: STORY.blocks.subsection }));
    await settle();
    expect(storyPatches().at(-1)?.blocks[0]).toEqual({ type: 'heading', level: 3, id: 'the-plan', text: 'The plan' });
  });

  it('an embed’s provider is chosen from the picker', async () => {
    mockProject = async () => project({ story: doc([]) });
    await show();
    await fireEvent.press(screen.getByTestId('story-add-embed'));
    await settle();
    await fireEvent.press(screen.getByTestId('story-block-0-provider'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Vimeo' }));
    await fireEvent.changeText(screen.getByTestId('story-block-0-url'), 'https://vimeo.com/1');
    await fireEvent.changeText(screen.getByTestId('story-block-0-title'), 'A film');
    await blur('story-block-0-title');
    expect(storyPatches().at(-1)?.blocks[0]).toEqual({
      type: 'embed',
      provider: 'vimeo',
      url: 'https://vimeo.com/1',
      title: 'A film',
    });
  });

  it.each([
    ['library', 'launchImageLibraryAsync'],
    ['camera', 'launchCameraAsync'],
  ] as const)('an image block takes an upload from the %s', async (source, launcher) => {
    mockProject = async () => project({ story: doc([]) });
    picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///photo.heic', mimeType: 'image/jpeg' }] });
    upload.mockResolvedValue({ mediaId: 'm1', url: 'https://cdn.example.com/m1.jpg', width: 1200, height: 800, blurDataUrl: '' });
    await show();
    await fireEvent.press(screen.getByTestId('story-add-image'));
    await settle();
    await fireEvent.press(screen.getByTestId(`story-block-0-source-${source}`));
    await settle();
    expect(ImagePicker[launcher]).toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith('file:///photo.heic', expect.anything());
    expect(screen.getByTestId('story-block-0-size')).toHaveTextContent('1200×800 pixels');

    await fireEvent.changeText(screen.getByTestId('story-block-0-alt'), 'The lamp');
    await blur('story-block-0-alt');
    expect(storyPatches().at(-1)?.blocks[0]).toEqual({
      type: 'image',
      url: 'https://cdn.example.com/m1.jpg',
      width: 1200,
      height: 800,
      alt: 'The lamp',
    });
  });

  it('the refusal mark follows its block when the block moves, and goes with it', async () => {
    mockSend.mockRejectedValueOnce(
      new ApiError(422, {
        status: 422,
        code: 'STORY_DOCUMENT_INVALID',
        errors: { story: 'That anchor is reserved.' },
        meta: { path: 'blocks[2].id' },
      }),
    );
    await show();
    await fireEvent.changeText(screen.getByTestId('story-block-1-text'), 'Edited.');
    await blur('story-block-1-text');
    expect(within(screen.getByTestId('story-block-2')).getByText('That anchor is reserved.')).toBeTruthy();

    mockSend.mockImplementation(() => new Promise(() => {})); // the next answer never comes
    await fireEvent.press(screen.getByTestId('story-block-2-up'));
    await settle();
    expect(within(screen.getByTestId('story-block-1')).getByText('That anchor is reserved.')).toBeTruthy();
    expect(screen.queryByTestId('story-block-2-problem')).toBeNull();

    await fireEvent.press(screen.getByTestId('story-block-1-remove'));
    await settle();
    expect(screen.queryByText('That anchor is reserved.')).toBeNull();
  });

  it('a preview answer for a version no longer asked for is dropped', async () => {
    mockVersions = async () => [
      { number: 7, createdAt: '2026-10-05T09:30:00.000Z', authorId: 'u1', characters: 10 },
      { number: 6, createdAt: '2026-10-04T09:30:00.000Z', authorId: 'u1', characters: 10 },
    ];
    const answers = new Map<number, (value: unknown) => void>();
    mockVersion = (number) => new Promise((resolve) => answers.set(number, resolve));
    await show();
    await fireEvent.press(screen.getByTestId('story-history-open'));
    await settle();
    await fireEvent.press(screen.getByTestId('story-version-7-preview'));
    await fireEvent.press(screen.getByTestId('story-version-6-preview'));
    await act(async () =>
      answers.get(6)?.({ number: 6, document: doc([{ type: 'paragraph', spans: parseSpans('Six.') }]) }),
    );
    await act(async () =>
      answers.get(7)?.({ number: 7, document: doc([{ type: 'paragraph', spans: parseSpans('Seven.') }]) }),
    );
    await settle();
    expect(within(screen.getByTestId('story-version-6-content')).getByText('Paragraph: Six.')).toBeTruthy();
    expect(screen.queryByTestId('story-version-7-content')).toBeNull();
    expect(screen.queryByText('Paragraph: Seven.')).toBeNull();
  });

  it('an offered change never sends a story over one this build cannot read', async () => {
    const store = memoryStore();
    writeUnsent(store, unsentKeyFor('p1'), {
      patch: { story: doc(BLOCKS), title: 'Kept title' },
      at: '2026-10-07T08:00:00.000Z',
    });
    mockProject = async () => project({ story: { version: 99, blocks: [] } as unknown as StoryDocument });
    await show({ store });
    expect(readUnsent(store, unsentKeyFor('p1'))?.patch).toEqual({ title: 'Kept title' });
  });
});

describe('StoryPanel — a large font', () => {
  const flat = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style);

  it('keeps the counter beside "Earlier versions" at the normal size', async () => {
    await show();
    expect(flat('story-counter').flexDirection).toBe('row');
  });

  it('stacks the counter over "Earlier versions" at 1.4×, instead of squeezing the sentence', async () => {
    mockFontScale = 1.4;
    await show();
    const counter = flat('story-counter');
    expect(counter.flexDirection).toBeUndefined();
    expect(counter.alignItems).toBe('flex-start');
    expect(within(screen.getByTestId('story-counter')).getByTestId('story-history-open')).toBeTruthy();
  });
});
