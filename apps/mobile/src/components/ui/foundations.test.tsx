import { render } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, font, tint } from '../../theme';
import { FadeUp, FIRST_SCREENFUL } from '../motion';
import { Body, Heading, Story } from '../text';
import { announce } from './announce';
import { haptics } from './haptics';
import { MotionBudgetProvider, useMotionAllowed } from './motion-budget';
import { SurfaceProvider, TONES } from './surface';

/**
 * The kit's foundations — the pieces every component leans on, tested once here so each
 * component's own tests can assume them: the surface a text sits on decides its colour, the
 * motion budget and Reduce Motion both stop animation, haptics are a closed list, and an
 * announcement is polite unless it is an error.
 */

function colourOf(element: { props: { style?: unknown } }) {
  return StyleSheet.flatten(element.props.style as StyleProp<TextStyle>)?.color;
}

describe('SurfaceContext — the native data-on-lime', () => {
  it('draws text in the dark tones by default', async () => {
    const { getByText } = await render(<Body>Prose</Body>);
    expect(colourOf(getByText('Prose'))).toBe(colors.textSecondary);
  });

  it('switches a heading to near-black and body to on-lime/72 inside a lime surface', async () => {
    const { getByText } = await render(
      <SurfaceProvider surface="lime">
        <Heading>Ends in 2 days</Heading>
        <Body>Pledge before Friday</Body>
      </SurfaceProvider>,
    );
    expect(colourOf(getByText('Ends in 2 days'))).toBe(colors.textOnLime);
    expect(colourOf(getByText('Pledge before Friday'))).toBe(TONES.lime.secondary);
    expect(colourOf(getByText('Pledge before Friday'))).not.toBe(colors.textSecondary);
  });

  it('switches to on-white inside a white surface', async () => {
    const { getByText } = await render(
      <SurfaceProvider surface="white">
        <Heading>Summary</Heading>
        <Body>Shipping included</Body>
      </SurfaceProvider>,
    );
    expect(colourOf(getByText('Summary'))).toBe(colors.textOnWhite);
    expect(colourOf(getByText('Shipping included'))).toBe(tint(colors.textOnWhite, 0.64));
  });

  it('sets the story at the reading size, in Inter', async () => {
    const { getByText } = await render(<Story>Once upon a time</Story>);
    const style = StyleSheet.flatten(getByText('Once upon a time').props.style);
    expect(style).toMatchObject({
      fontSize: 17,
      lineHeight: 30,
      fontFamily: font.regular.fontFamily,
    });
  });
});

/**
 * Whether `FadeUp` built an entry animation is read off Reanimated's own builder: the animated
 * branch calls `FadeInDown.duration(...)` and the still branch never touches it. The rendered
 * host tree cannot tell the two apart — both are one `View` around the child.
 */
describe('the motion budget and Reduce Motion', () => {
  let built: jest.SpyInstance;
  beforeEach(() => {
    built = jest.spyOn(FadeInDown, 'duration');
  });
  afterEach(() => jest.restoreAllMocks());

  const fadeUp = (
    <FadeUp>
      <View testID="child" />
    </FadeUp>
  );

  it('renders FadeUp without animation under a budget of none', async () => {
    await render(<MotionBudgetProvider level="none">{fadeUp}</MotionBudgetProvider>);
    expect(built).not.toHaveBeenCalled();
  });

  it('animates FadeUp where the budget allows it', async () => {
    await render(<MotionBudgetProvider level="full">{fadeUp}</MotionBudgetProvider>);
    expect(built).toHaveBeenCalled();
  });

  it('animates FadeUp under the default budget, which is full on mobile', async () => {
    await render(fadeUp);
    expect(built).toHaveBeenCalled();
  });

  it('leaves FadeUp still past the first screenful (mobile-design skill §6.5)', async () => {
    await render(
      <FadeUp index={FIRST_SCREENFUL}>
        <View testID="child" />
      </FadeUp>,
    );
    expect(built).not.toHaveBeenCalled();
  });

  /** The one question every animated primitive asks, answered with the device setting on. */
  function Allowed({ level }: { level: 'minimal' | 'moderate' | 'full' }) {
    return <Text>{String(useMotionAllowed(level))}</Text>;
  }

  it('refuses motion at every level when the device asks for Reduce Motion, whatever the budget', async () => {
    // `mockResolvedValueOnce`: the platform mock is already a `jest.fn`, so `spyOn` returns it
    // and a lasting `mockResolvedValue` would outlive `restoreAllMocks` into the next test.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const { findByText } = await render(
      <MotionBudgetProvider level="full">
        <Allowed level="minimal" />
      </MotionBudgetProvider>,
    );
    expect(await findByText('false')).toBeTruthy();
  });

  it('ranks the levels as docs/motion-system.md §5 does', async () => {
    const { findAllByText } = await render(
      <MotionBudgetProvider level="moderate">
        <Allowed level="minimal" />
        <Allowed level="moderate" />
        <Allowed level="full" />
      </MotionBudgetProvider>,
    );
    expect(await findAllByText('true')).toHaveLength(2);
    expect(await findAllByText('false')).toHaveLength(1);
  });
});

describe('haptics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes exactly the five events in docs/motion-system.md §7', () => {
    expect(Object.keys(haptics).sort()).toEqual(
      ['paymentFailed', 'pledgeConfirmed', 'refresh', 'save', 'selectReward'].sort(),
    );
  });

  it('maps each event to the feedback the table names', () => {
    haptics.save();
    haptics.selectReward();
    haptics.pledgeConfirmed();
    haptics.paymentFailed();
    haptics.refresh();

    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });

  it('never throws when the phone has no motor', async () => {
    jest.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error('unsupported'));
    expect(() => haptics.save()).not.toThrow();
    await Promise.resolve();
  });
});

describe('announce — the native aria-live', () => {
  // The platform mock is a `jest.fn` shared by every test, so its calls are cleared first.
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('queues a polite announcement behind whatever is being read, on iOS', () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    expect(Platform.OS).toBe('ios');

    announce('Saved');
    expect(spy).toHaveBeenCalledWith('Saved', { queue: true });
  });

  it('interrupts for an assertive one — an error', () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    announce('Payment failed', { assertive: true });
    expect(spy).toHaveBeenCalledWith('Payment failed', { queue: false });
  });

  it('says nothing for an empty message', () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {});
    announce('');
    expect(spy).not.toHaveBeenCalled();
  });
});
