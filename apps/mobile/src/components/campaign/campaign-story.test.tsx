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
