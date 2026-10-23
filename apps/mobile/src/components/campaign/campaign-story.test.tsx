import { Linking, StyleSheet, type TextStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { readStoryDocument, type StoryDocument } from '@ideanest/campaign/story';
import { colors } from '../../theme';
import { SurfaceProvider, TONES } from '../ui';
import { CampaignStory } from './campaign-story';

/**
 * The story renderer — issue #155 (#140): every block of the version-1 schema as native text,
 * nothing for a document the shared reader refuses, and embeds handed to the system.
 */

const DOCUMENT = {
  version: 1,
  blocks: [
    { type: 'heading', level: 2, id: 'why', text: 'Why a lamp' },
    {
      type: 'paragraph',
      spans: [
        { text: 'It charges ', marks: [] },
        { text: 'in the sun', marks: ['em'] },
        { text: ' and lasts ', marks: [] },
        { text: 'all night', marks: ['strong'] },
        { text: '.', marks: [] },
      ],
    },
    { type: 'heading', level: 3, id: 'parts', text: 'The parts' },
    {
      type: 'list',
      ordered: true,
      items: [
        [{ text: 'A panel', marks: [] }],
        [{ text: 'A battery', marks: [] }],
      ],
    },
    { type: 'list', ordered: false, items: [[{ text: 'Recycled glass', marks: [] }]] },
    { type: 'quote', spans: [{ text: 'Light where there was none.', marks: [] }] },
    { type: 'rule' },
    {
      type: 'image',
      url: 'https://cdn.example/lamp-in-use.jpg',
      width: 1200,
      height: 1600,
      alt: 'The lamp on a kitchen table at night',
    },
    { type: 'embed', provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc', title: 'The lamp, assembled' },
    { type: 'embed', provider: 'vimeo', url: 'javascript:alert(1)', title: 'Not a link' },
  ],
};

function show(story: StoryDocument) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <CampaignStory story={story} title="Solar Lamp" />
    </IntlProvider>,
  );
}

function styleOf(node: { props: { style?: unknown } }): TextStyle {
  return StyleSheet.flatten(node.props.style as TextStyle);
}

describe('the story', () => {
  it('reads the service’s document with the shared reader', () => {
    expect(readStoryDocument(DOCUMENT)).not.toBeNull();
  });

  it('renders every block type of version 1', async () => {
    await show(readStoryDocument(DOCUMENT) as StoryDocument);

    // The hidden heading that names the story for somebody moving by heading.
    expect(screen.getByRole('header', { name: 'About Solar Lamp' })).toBeTruthy();

    const h2 = screen.getByRole('header', { name: 'Why a lamp' });
    expect(styleOf(h2).fontSize).toBe(24);
    const h3 = screen.getByRole('header', { name: 'The parts' });
    expect(styleOf(h3).fontSize).toBe(20);

    expect(styleOf(screen.getByText('in the sun')).fontStyle).toBe('italic');
    expect(styleOf(screen.getByText('all night')).color).toBe(colors.textPrimary);

    expect(screen.getByTestId('story-ordered')).toBeTruthy();
    expect(screen.getByText('A battery')).toBeTruthy();
    expect(screen.getByText('2.', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('story-unordered')).toBeTruthy();
    expect(screen.getByText('Recycled glass')).toBeTruthy();

    const quote = screen.getByTestId('story-quote');
    expect(StyleSheet.flatten(quote.props.style).borderLeftColor).toBe(colors.lime700);
    expect(screen.getByTestId('story-rule')).toBeTruthy();

    // The image at its own proportions, named by the creator's alt.
    const image = screen.getByRole('image', { name: 'The lamp on a kitchen table at night' });
    expect(image).toBeTruthy();
    const frame = screen.getByTestId('story-image').parent;
    expect(StyleSheet.flatten(frame?.props.style).aspectRatio).toBeCloseTo(1200 / 1600);
  });

  it('opens an embed outside the app, and never a non-web address', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await show(readStoryDocument(DOCUMENT) as StoryDocument);

    const embed = screen.getByRole('link', { name: 'The lamp, assembled — watch on YouTube' });
    await fireEvent.press(embed);
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abc');

    const refused = screen.getByRole('link', { name: 'Not a link — watch on Vimeo' });
    expect(refused.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    open.mockRestore();
  });

  it('is refused by the reader in a later version or with a malformed block', () => {
    expect(readStoryDocument({ ...DOCUMENT, version: 2 })).toBeNull();
    expect(
      readStoryDocument({ version: 1, blocks: [{ type: 'paragraph', spans: [{ text: 1 }] }] }),
    ).toBeNull();
    expect(readStoryDocument({ type: 'doc', content: [] })).toBeNull();
  });

  it('fixes no height on its text, so Dynamic Type grows it rather than clipping it', async () => {
    await show(readStoryDocument(DOCUMENT) as StoryDocument);
    for (const text of screen.getAllByText(/./, { includeHiddenElements: true })) {
      const style = styleOf(text);
      // The one exception is the visually hidden heading, which is a 1pt box on purpose.
      if (style.position === 'absolute') continue;
      expect(style.height).toBeUndefined();
      expect(text.props.numberOfLines).toBeUndefined();
    }
  });
});

describe('a section', () => {
  const SECTIONS = {
    version: 1,
    blocks: [
      { type: 'paragraph', spans: [{ text: 'Before the workshop.', marks: [] }] },
      {
        type: 'section',
        id: 'our-workshop',
        title: 'Our workshop',
        image: { url: 'https://cdn.example/workshop.jpg', width: 1440, height: 960, alt: 'Two benches and a kiln' },
        spans: [
          { text: 'Every lamp is ', marks: [] },
          { text: 'hand-blown', marks: ['em'] },
          { text: ' here.', marks: [] },
        ],
      },
      // The service omits a null field, so a section without a picture may arrive without the key.
      { type: 'section', id: 'the-team', title: 'The team', spans: [] },
    ],
  };

  it('is read by the shared reader, with or without its picture', () => {
    const story = readStoryDocument(SECTIONS);
    expect(story).not.toBeNull();
    expect(story?.blocks[2]).toEqual({
      type: 'section',
      id: 'the-team',
      title: 'The team',
      image: null,
      video: null,
      spans: [],
    });
  });

  it('draws its title as a level-2 header, its picture at its own shape, then its text', async () => {
    await show(readStoryDocument(SECTIONS) as StoryDocument);

    const title = screen.getByRole('header', { name: 'Our workshop' });
    expect(styleOf(title).fontSize).toBe(24);
    // The anchor the navigation would scroll to.
    expect(screen.getByTestId('story-section-our-workshop').props.nativeID).toBe('our-workshop');

    const image = screen.getByRole('image', { name: 'Two benches and a kiln' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example/workshop.jpg' });
    // The box is reserved before the picture decodes, at the picture's own proportions.
    const frame = screen.getByTestId('story-section-image').parent;
    expect(StyleSheet.flatten(frame?.props.style).aspectRatio).toBeCloseTo(1440 / 960);

    expect(screen.getByText('hand-blown')).toBeTruthy();
    expect(styleOf(screen.getByText('hand-blown')).fontStyle).toBe('italic');
  });

  it('without a picture or text, is its title alone', async () => {
    await show(readStoryDocument(SECTIONS) as StoryDocument);
    const team = screen.getByTestId('story-section-the-team');
    expect(screen.getByRole('header', { name: 'The team' })).toBeTruthy();
    expect(screen.getAllByTestId('story-section-image')).toHaveLength(1);
    expect(team.children).toHaveLength(1);
  });

  it('draws a picture with an empty description as decorative, not as an unnamed image (#543)', async () => {
    const picture = { url: 'https://cdn.example/workshop.jpg', width: 1440, height: 960, alt: '' };
    await show(
      readStoryDocument({
        version: 1,
        blocks: [
          { type: 'image', ...picture },
          { type: 'section', id: 'our-workshop', title: 'Our workshop', image: { ...picture, alt: '  ' }, spans: [] },
        ],
      }) as StoryDocument,
    );

    expect(screen.queryAllByRole('image')).toHaveLength(0);
    for (const id of ['story-image', 'story-section-image']) {
      const image = screen.getByTestId(id, { includeHiddenElements: true });
      expect(image.props.source).toEqual({ uri: picture.url });
      expect(image.props.accessible).toBe(false);
      expect(image.props.importantForAccessibility).toBe('no-hide-descendants');
    }
  });

  it('draws a video as its poster and a play button named by the title, and plays only when pressed (#551)', async () => {
    await show(
      readStoryDocument({
        version: 1,
        blocks: [
          {
            type: 'section',
            id: 'our-workshop',
            title: 'Our workshop',
            image: null,
            video: {
              mediaId: '0b6c2f4e-5f63-4c8e-9a51-2f7e4d1b9c10',
              url: 'https://cdn.example/v.mp4',
              posterUrl: 'https://cdn.example/v-poster.jpg',
              width: 720,
              height: 1280,
              durationMs: 42_000,
            },
            spans: [],
          },
        ],
      }) as StoryDocument,
    );

    const poster = screen.getByTestId('story-section-poster', { includeHiddenElements: true });
    expect(poster.props.source).toEqual({ uri: 'https://cdn.example/v-poster.jpg' });
    // The 16:9 box is reserved before the poster decodes; a portrait clip is letterboxed in it.
    expect(StyleSheet.flatten(poster.parent?.props.style).aspectRatio).toBeCloseTo(16 / 9);
    expect(screen.queryByTestId('campaign-video-player')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Watch the video: Our workshop' }));
    expect(screen.getByTestId('campaign-video-player').props.accessibilityLabel).toBe('Video: Our workshop');
  });
});

describe('the story inside the white content sheet (#281)', () => {
  it('takes the sheet’s on-white tones and draws no lime rule on white', async () => {
    const story = readStoryDocument(DOCUMENT) as StoryDocument;
    await render(
      <IntlProvider locale="en" messages={en}>
        <SurfaceProvider surface="white">
          <CampaignStory story={story} title="Solar Lamp" />
        </SurfaceProvider>
      </IntlProvider>,
    );
    expect(styleOf(screen.getByText('all night')).color).toBe(TONES.white.primary);
    const quote = screen.getByTestId('story-quote');
    expect(StyleSheet.flatten(quote.props.style).borderLeftColor).not.toBe(colors.lime700);
    // The sheet is the card: no second fill under the story.
    expect(StyleSheet.flatten(screen.getByTestId('campaign-story').props.style).backgroundColor).toBeUndefined();
  });

  it('presses an embed link with the press scale', async () => {
    const story = readStoryDocument(DOCUMENT) as StoryDocument;
    await show(story);
    const [embed] = screen.getAllByTestId('story-embed');
    expect(StyleSheet.flatten(embed?.parent?.props.style)?.transform).toEqual([{ scale: 1 }]);
  });
});
