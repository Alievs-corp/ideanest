import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Heart, Plus } from 'lucide-react';
import { Pill } from './Pill';

const meta = {
  title: 'Primitives/Pill',
  component: Pill,
  parameters: {
    docs: {
      description: {
        component:
          '`accent` (lime) is the URGENT action. **At most one per screen** — beyond that, urgency stops meaning anything.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'accent', 'ghost', 'outline', 'danger'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
  args: { children: 'Back this project' },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { variant: 'primary', size: 'md' } };

export const Variants: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Pill variant="primary">Primary</Pill>
      <Pill variant="accent">Accent — urgent</Pill>
      <Pill variant="ghost">Ghost</Pill>
      <Pill variant="outline">Outline</Pill>
      <Pill variant="danger">Danger</Pill>
      <Pill variant="primary" disabled>
        Disabled
      </Pill>
    </div>
  ),
};

export const Sizes: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Pill size="sm">Small</Pill>
      <Pill size="md">Medium</Pill>
      <Pill size="lg">Large</Pill>
    </div>
  ),
};

export const WithIcons: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Pill iconLeft={<Plus className="size-4" />}>New project</Pill>
      <Pill variant="accent" iconRight={<ArrowRight className="size-4" />}>
        Back it
      </Pill>
      <Pill variant="ghost" iconLeft={<Heart className="size-4" />}>
        Save
      </Pill>
    </div>
  ),
};

/** Realistic pairing: one accent action, one quiet action. */
export const InContext: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="w-[420px] rounded-xl border border-fg/8 bg-surface-2 p-6">
      <div className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums">
        1,111,561
      </div>
      <div className="mt-1 text-sm text-fg-64">pledged of 100,000 goal</div>
      <div className="mt-5 flex gap-2">
        <Pill variant="accent" fullWidth>
          Back this project
        </Pill>
        <Pill variant="ghost" iconLeft={<Heart className="size-4" />} aria-label="Save">
          <span className="sr-only">Save</span>
        </Pill>
      </div>
    </div>
  ),
};
