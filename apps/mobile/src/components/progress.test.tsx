import type { ReactElement } from 'react';
import { render as renderBare } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { IntlProvider } from 'use-intl';
import { colors } from '@ideanest/design-tokens';
import en from '@ideanest/messages/en.json';
import { PROGRESS_FILL, ProgressBar } from './progress';
import { MotionBudgetProvider } from './ui/motion-budget';

/**
 * The two rules from CLAUDE.md §2 that this component is where you break.
 *
 * <p><strong>Lime means urgent, success means achieved.</strong> One token swapped here
 * tells a backer that a campaign still asking for money has already made it, on every
 * card in the feed.
 *
 * <p><strong>Colour alone never carries meaning.</strong> The difference between the two
 * states has to survive a screen reader and a person who cannot tell lime from green.
 *
 * <p>Every `render` is awaited: it is asynchronous from `@testing-library/react-native`
 * v14 onwards, and a forgotten `await` yields a promise whose query functions are simply
 * missing — which reads as the library being broken rather than as a missing keyword.
 *
 * <p>The words come from the catalogue (issue #150), so every render is in English through
 * the provider the application wraps every screen in.
 *
 * <p>The bar moved into the UI kit (issue #151) and this path re-exports it. The fill is now always
 * the track's full width and draws its fraction as `transform: scaleX`, because animating `width`
 * forces layout on every frame; so the figure is read from the transform, under a `none` motion
 * budget where the fill is drawn at its value rather than rising towards it.
 */

function render(ui: ReactElement) {
  return renderBare(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

async function fill(percent: string) {
  const { getByTestId } = await render(
    <MotionBudgetProvider level="none">
      <ProgressBar completionPercent={percent} label="Funding" />
    </MotionBudgetProvider>,
  );
  return StyleSheet.flatten(getByTestId(PROGRESS_FILL).props.style);
}

/** The drawn fraction of the track, from the fill's `scaleX`. */
function scaleX(style: { transform?: unknown }): unknown {
  return Array.isArray(style.transform)
    ? (style.transform as Record<string, unknown>[]).find((step) => 'scaleX' in step)?.scaleX
    : undefined;
}

describe('ProgressBar', () => {
  it('is lime while a campaign is still asking', async () => {
    expect((await fill('42.5')).backgroundColor).toBe(colors.lime500);
  });

  it('is success once the goal is reached, not lime', async () => {
    // The whole reason both tokens exist. `--lime-500` says "act now".
    expect((await fill('100')).backgroundColor).toBe(colors.success);
    expect((await fill('340')).backgroundColor).toBe(colors.success);
  });

  it('clamps the bar at 100 while the label keeps the real figure', async () => {
    // 340% is earned and worth printing. A bar drawn at 340% of its track is a layout bug.
    expect(scaleX(await fill('340'))).toBe(1);

    const { getByText } = await render(<ProgressBar completionPercent="340" label="Funding" />);
    expect(getByText('340% — funded')).toBeTruthy();
  });

  it('says in words what the colour says', async () => {
    const reached = await render(<ProgressBar completionPercent="100" label="Funding" />);
    const asking = await render(<ProgressBar completionPercent="60" label="Funding" />);

    // Not "100%" and "60%": the difference between the two states is in the words as
    // well as in the colour.
    expect(reached.getByText('100% — funded')).toBeTruthy();
    expect(asking.getByText('60% funded')).toBeTruthy();
  });

  it('announces the figure to a screen reader', async () => {
    const { getByLabelText } = await render(
      <ProgressBar completionPercent="42.5" label="Funding progress for Solar Lamp" />,
    );

    const bar = getByLabelText('Funding progress for Solar Lamp');
    expect(bar.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 43,
      text: '43 percent of the goal',
    });
  });

  it('draws nothing rather than throwing on a figure it cannot read', async () => {
    // The value arrives from the network. A campaign page that crashes on a malformed
    // percentage is worse than one that shows zero.
    expect(scaleX(await fill('not-a-number'))).toBe(0);
    expect(scaleX(await fill(''))).toBe(0);
  });
});
