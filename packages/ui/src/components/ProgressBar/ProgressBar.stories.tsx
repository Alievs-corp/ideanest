import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressBar } from './ProgressBar';

const meta = {
  title: 'Primitives/ProgressBar',
  component: ProgressBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'At 100% the fill switches from **lime to success**, and nothing else changes: no glow, because a lime halo on a success fill would say both things at once. Lime means "in progress"; success means "achieved".',
      },
    },
  },
  argTypes: { value: { control: { type: 'range', min: 0, max: 150, step: 1 } } },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { value: 64 },
  render: (args) => (
    <div className="w-[420px]">
      <ProgressBar {...args} />
      <div className="mt-2 text-sm tabular-nums">{args.value}%</div>
    </div>
  ),
};

export const States: Story = {
  args: { value: 0 },
  render: () => (
    <div className="flex w-[420px] flex-col gap-6">
      {[12, 45, 87, 100, 1111].map((v) => (
        <div key={v}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium tabular-nums">{v.toLocaleString('en-US')}%</span>
            <span className="text-xs text-white/40">
              {v >= 100 ? 'Goal reached' : 'In progress'}
            </span>
          </div>
          <ProgressBar value={v} />
        </div>
      ))}
    </div>
  ),
};
