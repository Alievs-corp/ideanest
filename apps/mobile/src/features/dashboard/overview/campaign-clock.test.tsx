import { act, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { MotionBudgetProvider } from '../../../components/ui';
import { setLocale } from '../../../lib/locale';
import { CampaignClock } from './campaign-clock';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-10T12:00:00.000Z');

let clock = NOW;
const now = () => clock;
const at = (offset: number) => new Date(NOW + offset).toISOString();

async function show(deadline: string | null, options: { skewMs?: number; active?: boolean } = {}) {
  const view = await render(
    <MotionBudgetProvider level="full">
      <IntlProvider locale="en" messages={en}>
        <CampaignClock deadline={deadline} skewMs={options.skewMs ?? 0} active={options.active ?? true} now={now} />
      </IntlProvider>
    </MotionBudgetProvider>,
  );
  return view;
}

function text(): string {
  const node = screen.getByTestId('campaign-clock');
  return String(node.props.accessibilityLabel);
}

async function advance(ms: number) {
  clock += ms;
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  clock = NOW;
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CampaignClock', () => {
  it.each([
    [12 * DAY + 3 * HOUR, '12 days left'],
    [5 * HOUR + 3 * MINUTE, '5h 3m left'],
    [4 * MINUTE + 10 * SECOND, '4m 10s left'],
  ])('reads %i ms as "%s"', async (left, words) => {
    await show(at(left));
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('says Closed at and after the deadline, and nothing urgent', async () => {
    await show(at(-MINUTE));
    expect(screen.getByText(en.dashboard.clock.closed)).toBeTruthy();
    expect(screen.queryByTestId('campaign-clock-urgent')).toBeNull();
  });

  it('says there is no deadline yet rather than counting to nothing', async () => {
    await show(null);
    expect(screen.getByTestId('campaign-clock-none')).toHaveTextContent(en.dashboard.clock.none);
  });

  it('shows the lime "CLOSING SOON" capsule within 48 hours and not a minute before', async () => {
    await show(at(2 * DAY));
    expect(screen.getByTestId('campaign-clock-urgent')).toHaveTextContent(en.dashboard.clock.urgent.toUpperCase());
    // Said in words in the timer's name too, so the urgency is never colour alone.
    expect(text()).toBe(`2 days left, ${en.dashboard.clock.urgent}`);
    await screen.unmount();

    await show(at(2 * DAY + MINUTE));
    expect(screen.queryByTestId('campaign-clock-urgent')).toBeNull();
  });

  it('counts down against the service’s clock, not the phone’s', async () => {
    // The phone is forty minutes fast; without the skew it would say the campaign closes early.
    clock = NOW + 40 * MINUTE;
    await show(at(5 * DAY + 40 * MINUTE), { skewMs: 40 * MINUTE });
    expect(screen.getByText('5 days left')).toBeTruthy();
  });

  it('is a timer that is read when focused and never announces itself', async () => {
    await show(at(3 * MINUTE));
    const timer = screen.getByTestId('campaign-clock');
    expect(timer.props.accessibilityRole).toBe('timer');
    expect(timer.props.accessibilityLiveRegion).toBe('none');
  });
});

describe('how often it ticks', () => {
  it('ticks every second in the last hour', async () => {
    await show(at(2 * MINUTE + 30 * SECOND));
    expect(screen.getByText('2m 30s left')).toBeTruthy();
    await advance(SECOND);
    expect(screen.getByText('2m 29s left')).toBeTruthy();
  });

  it('ticks once a minute while more than an hour is left', async () => {
    await show(at(5 * HOUR + 3 * MINUTE + 30 * SECOND));
    expect(screen.getByText('5h 3m left')).toBeTruthy();
    // Forty seconds later the phone's clock says 5h 2m 50s, but nothing has re-rendered yet.
    await advance(40 * SECOND);
    expect(screen.getByText('5h 3m left')).toBeTruthy();
    await advance(20 * SECOND);
    expect(screen.getByText('5h 2m left')).toBeTruthy();
  });

  it('drops to seconds as it crosses into the last hour', async () => {
    await show(at(HOUR + 30 * SECOND));
    expect(screen.getByText('1h 0m left')).toBeTruthy();
    await advance(MINUTE);
    expect(screen.getByText('59m 30s left')).toBeTruthy();
    await advance(SECOND);
    expect(screen.getByText('59m 29s left')).toBeTruthy();
  });

  it('turns to Closed at the deadline', async () => {
    await show(at(2 * SECOND));
    await advance(2 * SECOND);
    expect(screen.getByText(en.dashboard.clock.closed)).toBeTruthy();
  });
});

describe('in the background', () => {
  it('stops ticking, and recomputes at once on the way back', async () => {
    const view = await show(at(2 * MINUTE));
    expect(screen.getByText('2m 0s left')).toBeTruthy();

    await view.rerender(
      <MotionBudgetProvider level="full">
        <IntlProvider locale="en" messages={en}>
          <CampaignClock deadline={at(2 * MINUTE)} skewMs={0} active={false} now={now} />
        </IntlProvider>
      </MotionBudgetProvider>,
    );
    await advance(30 * SECOND);
    expect(screen.getByText('2m 0s left')).toBeTruthy();

    await view.rerender(
      <MotionBudgetProvider level="full">
        <IntlProvider locale="en" messages={en}>
          <CampaignClock deadline={at(2 * MINUTE)} skewMs={0} active now={now} />
        </IntlProvider>
      </MotionBudgetProvider>,
    );
    expect(screen.getByText('1m 30s left')).toBeTruthy();
  });
});
