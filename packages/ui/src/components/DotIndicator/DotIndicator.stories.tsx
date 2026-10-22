import type { Meta, StoryObj } from '@storybook/react-vite';
import { DotIndicator } from './DotIndicator';

const meta = {
  title: 'Primitives/DotIndicator',
  component: DotIndicator,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'This must **never be the only carrier of the information** (docs/ui-kit.md §9.4). `aria-label` states the percentage, and a numeric figure belongs beside it.',
      },
    },
  },
  argTypes: { percent: { control: { type: 'range', min: 0, max: 150, step: 1 } } },
  args: { percent: 64 },
} satisfies Meta<typeof DotIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Scale: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {[0, 15, 40, 64, 88, 100, 143].map((p) => (
        <div key={p} className="flex items-center gap-4">
          <DotIndicator percent={p} />
          <span className="text-sm tabular-nums text-fg-64">{p}%</span>
        </div>
      ))}
    </div>
  ),
};

/** On a lime surface the status hues vanish, so the dots switch to near-black. */
export const OnLime: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-4 rounded-lg bg-lime-500 p-5">
      {[22, 64, 100, 143].map((p) => (
        <div key={p} className="flex items-center gap-4">
          <DotIndicator percent={p} onLime />
          <span className="text-sm tabular-nums text-on-lime/70">{p}%</span>
        </div>
      ))}
    </div>
  ),
};
