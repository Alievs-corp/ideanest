import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../../theme';
import { Body } from '../text';
import { TabBarInsetProvider, tabBarFootprint } from '../tab-bar';
import { ContentSheet } from './content-sheet';
import { TONES } from './surface';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function inSafeArea(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function sheetStyle(tree: Awaited<ReturnType<typeof inSafeArea>>): ViewStyle {
  return StyleSheet.flatten(tree.getByTestId('sheet').props.style as ViewStyle);
}

describe('ContentSheet', () => {
  it('is a white block with radius.xl top corners that bleeds through the screen gutter', async () => {
    const tree = await inSafeArea(
      <ContentSheet testID="sheet">
        <Body>Row</Body>
      </ContentSheet>,
    );
    const style = sheetStyle(tree);
    expect(style.backgroundColor).toBe(colors.whiteSurface);
    expect(style.borderTopLeftRadius).toBe(radius.xl);
    expect(style.borderTopRightRadius).toBe(radius.xl);
    expect(style.marginHorizontal).toBe(-spacing[5]);
  });

  it('reads its content in the white surface tones', async () => {
    const tree = await inSafeArea(
      <ContentSheet testID="sheet">
        <Body>Row</Body>
      </ContentSheet>,
    );
    const color = StyleSheet.flatten(tree.getByText('Row').props.style as TextStyle).color;
    expect(color).toBe(TONES.white.secondary);
  });

  it('runs to the bottom edge and pads its content clear of the home indicator', async () => {
    const style = sheetStyle(await inSafeArea(<ContentSheet testID="sheet" />));
    expect(style.marginBottom).toBe(-34);
    expect(style.paddingBottom).toBe(34 + spacing[6]);
  });

  it('pads clear of the floating tab bar on a tab screen', async () => {
    const style = sheetStyle(
      await inSafeArea(
        <TabBarInsetProvider>
          <ContentSheet testID="sheet" />
        </TabBarInsetProvider>,
      ),
    );
    expect(style.marginBottom).toBe(-tabBarFootprint(34));
    expect(style.paddingBottom).toBe(tabBarFootprint(34) + spacing[6]);
  });

  it('announces its title as a heading', async () => {
    const tree = await inSafeArea(<ContentSheet testID="sheet" title="Pledges" />);
    expect(tree.getByRole('header').props.children).toBe('Pledges');
  });
});
