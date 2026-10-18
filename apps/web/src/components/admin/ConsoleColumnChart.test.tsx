import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsoleColumnChart } from './ConsoleColumnChart';
import { translatorFor } from '../../test-copy';
import { consoleChartCopyFrom } from '../../lib/i18n/admin/common-copy';
import { expectNoViolations } from '../../test-axe';

const COPY = consoleChartCopyFrom(translatorFor('admin'));

function draw(points: { day: string; amount: string; count: number }[], from: string, to: string) {
  return render(
    <ConsoleColumnChart points={points} from={from} to={to} currency="AZN" locale="en" copy={COPY} />,
  );
}

describe('ConsoleColumnChart', () => {
  it('draws a year as thirteen months and names them in the tooltip', async () => {
    const { container } = draw(
      [
        { day: '2026-02-03', amount: '10.00', count: 1 },
        { day: '2026-02-20', amount: '15.50', count: 2 },
      ],
      '2025-10-19',
      '2026-10-18',
    );

    expect(container.querySelectorAll('[data-chart-column]')).toHaveLength(13);
    expect(screen.getByText(COPY.granularity.month)).toBeInTheDocument();
    // The month's two days are one column, added exactly.
    expect(screen.getByText(/Highest: February 2026 — 25\.50 AZN/)).toBeInTheDocument();

    const chart = screen.getByRole('group', { name: /^Pledged from/ });
    chart.focus();
    await userEvent.keyboard('{Home}');
    // A month the range only partly covers is a range of days, not the whole month by name.
    expect(document.querySelector('[aria-live]')?.textContent).toBe('19 Oct 2025 – 31 Oct 2025: 0.00 AZN, Pledges: 0');
  });

  it('draws ninety days as weeks', () => {
    const { container } = draw([], '2026-07-21', '2026-10-18');

    expect(container.querySelectorAll('[data-chart-column]')).toHaveLength(13);
    expect(screen.getByText(COPY.granularity.week)).toBeInTheDocument();
  });

  it('keeps a scale and no highlight when nothing was pledged', () => {
    draw([], '2026-10-01', '2026-10-07');

    expect(screen.queryByText(/Highest:/)).not.toBeInTheDocument();
    expect(screen.getByText('Total: 0.00 AZN')).toBeInTheDocument();
  });

  it('lists every column in the table, the quiet ones included', async () => {
    draw([{ day: '2026-10-02', amount: '7.00', count: 1 }], '2026-10-01', '2026-10-03');

    await userEvent.click(screen.getByText(COPY.tableToggle));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[2]!).getByText('7.00 AZN')).toBeInTheDocument();
  });

  it('draws nothing for a range that is not one', () => {
    const { container } = draw([], '2026-10-03', '2026-10-01');

    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations', async () => {
    const { container } = draw([{ day: '2026-10-02', amount: '7.00', count: 1 }], '2026-10-01', '2026-10-30');

    await expectNoViolations(container);
  });
});
