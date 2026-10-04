import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { accent } from '../../theme';
import { Avatar } from './avatar';
import { AVATAR_STACK_MAX, AvatarStack, SourceDot } from './avatar-stack';

/**
 * Avatar stacks and source dots (#277): three faces at most and a `+N` for the rest, one sentence
 * to a screen reader, and a coloured dot that is never without its words.
 */

const PEOPLE = [
  { name: 'Aysel Məmmədova' },
  { name: 'Rauf Əliyev' },
  { name: 'Nigar Həsənova' },
  { name: 'Elvin Quliyev' },
  { name: 'Leyla Kərimova' },
];

describe('AvatarStack', () => {
  it('draws at most three faces and counts the rest, from the total when it is larger', async () => {
    await render(<AvatarStack people={PEOPLE} total={128} label="128 backers" />);
    expect(screen.getAllByText(/^[A-ZƏ]{2}$/, { includeHiddenElements: true })).toHaveLength(
      AVATAR_STACK_MAX,
    );
    expect(screen.getByText('+125', { includeHiddenElements: true })).toBeTruthy();
  });

  it('is one element to a screen reader, named by its sentence rather than three names', async () => {
    await render(<AvatarStack people={PEOPLE} label="5 backers" />);
    expect(screen.getByRole('image', { name: '5 backers' })).toBeTruthy();
    expect(screen.queryByRole('image', { name: 'Aysel Məmmədova' })).toBeNull();
    expect(screen.queryByText('+2')).toBeNull();
  });

  it('draws no count when everybody fits', async () => {
    await render(<AvatarStack people={PEOPLE.slice(0, 2)} label="2 backers" />);
    expect(screen.queryByText(/^\+/, { includeHiddenElements: true })).toBeNull();
  });

  it('overlaps each face after the first by a third of its size', async () => {
    await render(<AvatarStack people={PEOPLE.slice(0, 2)} label="2 backers" size="sm" />);
    const second = screen.getByText('RƏ', { includeHiddenElements: true }).parent?.parent;
    expect(StyleSheet.flatten(second?.props.style)?.marginLeft).toBe(-9);
  });
});

describe('SourceDot', () => {
  it('writes its label beside the dot: colour is never the only signal', async () => {
    await render(
      <SourceDot accent="mint" label="Garden kit" testID="source">
        <Avatar name="Aysel Məmmədova" size="sm" />
      </SourceDot>,
    );
    expect(screen.getByText('Garden kit')).toBeTruthy();
    const dot = screen.getByTestId('source-dot', { includeHiddenElements: true });
    expect(StyleSheet.flatten(dot.props.style).backgroundColor).toBe(accent.mint.surface);
    expect(dot.props.accessibilityElementsHidden).toBe(true);
  });

  it('keeps the child it marks', async () => {
    await render(
      <SourceDot accent="sun" label="Books">
        <Text>child</Text>
      </SourceDot>,
    );
    expect(screen.getByText('child')).toBeTruthy();
  });
});
