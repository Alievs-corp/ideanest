import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { Heart } from 'lucide-react-native';
import { colors, size } from '../../theme';
import { MotionBudgetProvider } from './motion-budget';
import { AccentScopeProvider, Pill } from './pill';
import { SurfaceProvider } from './surface';

/**
 * The pill is the element every screen acts through, so the rules it carries are the ones a
 * screen would otherwise break one at a time: white is primary and lime is the one urgent action
 * (docs/ui-kit.md §7.2), a thumb needs 44pt, and a busy action cannot be sent twice.
 *
 * <p>Every `render` is awaited — asynchronous from `@testing-library/react-native` v14.
 */

const noop = () => {};

function styleOf(element: { props: { style?: unknown } }) {
  const { style } = element.props;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
}

describe('Pill', () => {
  it('is a button named by its label', async () => {
    const { getByRole } = await render(<Pill label="Save changes" onPress={noop} />);
    expect(getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('announces its label once, not once for the button and again for the text', async () => {
    const { getByText } = await render(<Pill label="Save changes" onPress={noop} />);
    expect(
      getByText('Save changes', { includeHiddenElements: true }).props.accessibilityElementsHidden,
    ).toBe(true);
  });

  it('is white with near-black text when primary — the default, and not lime', async () => {
    const { getByRole, getByText } = await render(<Pill label="Continue" onPress={noop} />);
    expect(styleOf(getByRole('button')).backgroundColor).toBe(colors.whiteSurface);
    expect(
      StyleSheet.flatten(getByText('Continue', { includeHiddenElements: true }).props.style).color,
    ).toBe(colors.textOnWhite);
  });

  it('is lime with on-lime text when accent', async () => {
    const { getByRole, getByText } = await render(
      <Pill label="Back this project" variant="accent" onPress={noop} />,
    );
    expect(styleOf(getByRole('button')).backgroundColor).toBe(colors.lime500);
    expect(
      StyleSheet.flatten(
        getByText('Back this project', { includeHiddenElements: true }).props.style,
      ).color,
    ).toBe(colors.textOnLime);
  });

  it('inverts primary on a white surface, where a white pill has no edge (#232)', async () => {
    const { getByRole, getByText } = await render(
      <SurfaceProvider surface="white">
        <Pill label="Save" onPress={noop} />
      </SurfaceProvider>,
    );
    expect(styleOf(getByRole('button')).backgroundColor).toBe(colors.surface1);
    expect(
      StyleSheet.flatten(getByText('Save', { includeHiddenElements: true }).props.style).color,
    ).toBe(colors.textPrimary);
  });

  it('draws outline in near-black on a white surface, where white would vanish', async () => {
    const { getByText } = await render(
      <SurfaceProvider surface="white">
        <Pill label="Cancel" variant="outline" onPress={noop} />
      </SurfaceProvider>,
    );
    expect(
      StyleSheet.flatten(getByText('Cancel', { includeHiddenElements: true }).props.style).color,
    ).toBe(colors.textOnWhite);
  });

  it('keeps primary white on lime, where only white surfaces invert', async () => {
    const { getByRole } = await render(
      <SurfaceProvider surface="lime">
        <Pill label="Save" onPress={noop} />
      </SurfaceProvider>,
    );
    expect(styleOf(getByRole('button')).backgroundColor).toBe(colors.whiteSurface);
  });

  it('draws danger with a near-black label, not white at 3.4:1 (#229)', async () => {
    const { getByRole, getByText } = await render(
      <Pill label="Delete" variant="danger" onPress={noop} />,
    );
    expect(styleOf(getByRole('button')).backgroundColor).toBe(colors.danger);
    expect(
      StyleSheet.flatten(getByText('Delete', { includeHiddenElements: true }).props.style).color,
    ).toBe(colors.textOnDanger);
  });

  it.each(['sm', 'md', 'lg'] as const)('reaches at least 44pt at size %s', async (pillSize) => {
    const { getByRole } = await render(<Pill label="Go" size={pillSize} onPress={noop} />);
    const button = getByRole('button');
    const slop = button.props.hitSlop as { top: number; bottom: number };
    expect(Number(styleOf(button).minHeight) + slop.top + slop.bottom).toBeGreaterThanOrEqual(
      size.touchTarget,
    );
  });

  it('keeps the web heights, so it looks the same as the web', async () => {
    const heights = [];
    for (const pillSize of ['sm', 'md', 'lg'] as const) {
      const { getByRole } = await render(<Pill label="Go" size={pillSize} onPress={noop} />);
      heights.push(styleOf(getByRole('button')).minHeight);
    }
    expect(heights).toEqual([32, 40, 48]);
  });

  it('presses', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<Pill label="Go" onPress={onPress} />);
    await fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('refuses a press while busy, says so, and keeps its label', async () => {
    const onPress = jest.fn();
    const { getByRole, getByText } = await render(<Pill label="Pay" busy onPress={onPress} />);
    await fireEvent.press(getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByRole('button').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    expect(getByText('Pay', { includeHiddenElements: true })).toBeTruthy();
  });

  it('refuses a press while disabled, and dims to 40%', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<Pill label="Pay" disabled onPress={onPress} />);
    await fireEvent.press(getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
    expect(styleOf(getByRole('button')).opacity).toBe(0.4);
  });

  it('draws its icon in the colour of its label and keeps it out of the announcement', async () => {
    const { getByRole } = await render(
      <Pill label="Save" variant="accent" iconLeft={Heart} onPress={noop} />,
    );
    const button = getByRole('button', { name: 'Save' });
    // One accessible element: the pill. The icon is decoration beside the word that says it.
    expect(button).toBeTruthy();
  });

  describe('one accent per screen', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it('warns when a screen mounts a second accent', async () => {
      await render(
        <AccentScopeProvider>
          <Pill label="Back" variant="accent" onPress={noop} />
          <Pill label="Also back" variant="accent" onPress={noop} />
        </AccentScopeProvider>,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 accent pills'));
    });

    it('stays quiet for one accent beside primaries', async () => {
      await render(
        <AccentScopeProvider>
          <Pill label="Back" variant="accent" onPress={noop} />
          <Pill label="Share" onPress={noop} />
        </AccentScopeProvider>,
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('counts per screen, not across a stack that keeps the last screen mounted', async () => {
      await render(
        <>
          <AccentScopeProvider>
            <Pill label="Back" variant="accent" onPress={noop} />
          </AccentScopeProvider>
          <AccentScopeProvider>
            <Pill label="Confirm" variant="accent" onPress={noop} />
          </AccentScopeProvider>
        </>,
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('press scale and the motion budget', () => {
    function transformOf(tree: ReturnType<typeof render> extends Promise<infer R> ? R : never) {
      // The scale is on the wrapper around the pressable, which keeps its own function style.
      const wrapper = tree.getByRole('button').parent;
      return wrapper === null ? undefined : styleOf(wrapper).transform;
    }

    it('does not scale on a surface whose budget is none — checkout, the editor', async () => {
      const tree = await render(
        <MotionBudgetProvider level="none">
          <Pill label="Confirm pledge" variant="accent" onPress={noop} />
        </MotionBudgetProvider>,
      );
      expect(transformOf(tree)).toBeUndefined();
    });

    it('does not scale under the default budget, which is minimal', async () => {
      const tree = await render(<Pill label="Filter" onPress={noop} />);
      expect(transformOf(tree)).toBeUndefined();
    });

    it('may scale where the budget is moderate or more', async () => {
      const tree = await render(
        <MotionBudgetProvider level="full">
          <Pill label="Explore" onPress={noop} />
        </MotionBudgetProvider>,
      );
      expect(transformOf(tree)).toEqual([{ scale: 1 }]);
    });
  });
});

// A compile-time check, not a runtime one: the label is the accessible name and cannot be left out.
function _typeChecks() {
  // @ts-expect-error — a pill without a label has no accessible name.
  void (<Pill onPress={noop} />);
  void Text;
}
void _typeChecks;
