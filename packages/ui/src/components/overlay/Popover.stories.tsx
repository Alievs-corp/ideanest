import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { Popover } from './Popover';
import { Pill } from '../Pill/Pill';
import type { Placement } from './placement';

const meta = {
  title: 'Overlays/Popover',
  component: Popover,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Anchored and **non-modal**: the page behind stays live and reachable. Focus still moves in on open and returns to the anchor on close. Placement is hand-rolled and flips when the preferred side does not fit.',
      },
    },
  },
  args: {
    open: false,
    onOpenChange: () => {},
    anchorRef: { current: null },
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

function PopoverDemo({ placement }: { placement: Placement }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The measurement anchor wraps the trigger, so the trigger stays a
          plain `Pill` with no ref plumbing of its own. */}
      <span ref={anchorRef} className="inline-flex">
        <Pill variant="outline" onClick={() => setOpen((value) => !value)}>
          Fee breakdown
        </Pill>
      </span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement={placement}
        label="Fee breakdown"
      >
        <p className="text-fg">Where the money goes</p>
        <dl className="mt-3 flex flex-col gap-1.5">
          <div className="flex justify-between gap-8">
            <dt>Platform fee</dt>
            <dd className="tabular-nums">5.0%</dd>
          </div>
          <div className="flex justify-between gap-8">
            <dt>Payment processing</dt>
            <dd className="tabular-nums">2.9% + 0.30</dd>
          </div>
        </dl>
      </Popover>
    </>
  );
}

export const Bottom: Story = {
  render: () => <PopoverDemo placement="bottom" />,
};

export const Top: Story = {
  render: () => <PopoverDemo placement="top" />,
};

export const Right: Story = {
  render: () => <PopoverDemo placement="right" />,
};
