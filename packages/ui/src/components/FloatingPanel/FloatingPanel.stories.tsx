import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, X } from 'lucide-react';
import { FloatingPanel } from './FloatingPanel';
import { IconButton } from '../IconButton/IconButton';
import { Pill } from '../Pill/Pill';

const meta = {
  title: 'Primitives/FloatingPanel',
  component: FloatingPanel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The **only** place shadow is used. Inside it `text-fg-64` does not work — use `text-on-white/64`.',
      },
    },
  },
} satisfies Meta<typeof FloatingPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const headerAction = 'text-on-white/64 hover:bg-black/6 hover:text-on-white';

export const Default: Story = {
  args: {
    title: 'Summary',
    actions: (
      <>
        <IconButton
          icon={<Download />}
          label="Download"
          variant="ghost"
          size="sm"
          className={headerAction}
        />
        <IconButton icon={<X />} label="Close" variant="ghost" size="sm" className={headerAction} />
      </>
    ),
    children: (
      <div className="w-[320px] text-sm text-on-white/64">
        <p className="font-medium text-on-white">Documents</p>
        <p className="mt-2 leading-relaxed">
          Survey and shipping details that will be sent to backers once the campaign closes.
        </p>
      </div>
    ),
  },
};

/** Checkout — the one screen where a white surface dominates (docs/ui-kit.md §8.5). */
export const Checkout: Story = {
  render: () => (
    <div className="rounded-xl bg-surface-1 p-10">
      <FloatingPanel title="Confirm your pledge" className="w-[380px]">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-on-white/64">Reward — Early Bird</span>
            <span className="font-medium tabular-nums">599.00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-white/64">Shipping</span>
            <span className="font-medium tabular-nums">25.00</span>
          </div>
          <div className="my-1 h-px bg-black/8" />
          <div className="flex justify-between text-base">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">624.00</span>
          </div>
          <Pill variant="accent" fullWidth className="mt-3">
            Confirm pledge
          </Pill>
          <p className="mt-1 text-center text-xs text-on-white/40">
            You are only charged if the project reaches its goal.
          </p>
        </div>
      </FloatingPanel>
    </div>
  ),
};
