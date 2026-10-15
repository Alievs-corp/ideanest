import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Display, HEADLINE_SCALE, WordFitText, breaksMidWord } from './text';
import { fontSize } from '../theme';

function layout(lines: readonly string[]) {
  return { nativeEvent: { lines: lines.map((text) => ({ text })) } };
}

describe('breaksMidWord', () => {
  it('accepts lines that end on a space or a hyphen', () => {
    expect(breaksMidWord([{ text: 'Hələ mövcud ' }, { text: 'olmayanı ' }, { text: 'maliyyələşdirin' }])).toBe(false);
    expect(breaksMidWord([{ text: 'well-' }, { text: 'known' }])).toBe(false);
    expect(breaksMidWord([{ text: 'one line only' }])).toBe(false);
  });

  it('catches a line that ends inside a word', () => {
    expect(breaksMidWord([{ text: 'olmayanı mali' }, { text: 'yyələşdirin' }])).toBe(true);
  });
});

describe('WordFitText', () => {
  it('steps the size down while a word is split, and stops once every word fits', async () => {
    await render(
      <WordFitText testID="headline" style={{ fontSize: 40, lineHeight: 42 }}>
        Hələ mövcud olmayanı maliyyələşdirin
      </WordFitText>,
    );
    const size = () => StyleSheet.flatten(screen.getByTestId('headline').props.style).fontSize as number;
    expect(size()).toBe(40);

    await act(async () => screen.getByTestId('headline').props.onTextLayout(layout(['olmayanı mali', 'yyələşdirin'])));
    const once = size();
    expect(once).toBeLessThan(40);

    await act(async () => screen.getByTestId('headline').props.onTextLayout(layout(['olmayanı ', 'maliyyələşdirin'])));
    expect(size()).toBe(once);
  });

  it('turns off Android hyphenation so a word is never broken with a dash either', async () => {
    await render(<WordFitText testID="headline">Title</WordFitText>);
    expect(screen.getByTestId('headline').props.android_hyphenationFrequency).toBe('none');
  });
});

describe('Display', () => {
  it('draws at 95% of the display step', async () => {
    await render(<Display testID="display">Title</Display>);
    expect(StyleSheet.flatten(screen.getByTestId('display').props.style).fontSize).toBe(
      fontSize.display * HEADLINE_SCALE,
    );
  });
});
