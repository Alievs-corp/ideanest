import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Flame } from 'lucide-react';
import { Chip, ChipRow, RemovableChip } from './Chip';
import { SAMPLE_CATEGORIES } from '../../sample-data';

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  parameters: {
    docs: {
      description: {
        component:
          'The selected state is **white**, not lime — "urgent" is meaningless for a filter.',
      },
    },
  },
  args: { children: 'Technology' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { active: false } };
export const Active: Story = { args: { active: true } };
export const WithCount: Story = { args: { count: 24 } };

/** Horizontally scrolling filter row with a fading right edge. */
export const Row: Story = {
  parameters: { layout: 'padded' },
  render: function RowStory() {
    const [active, setActive] = useState<string>('All');
    return (
      <div className="w-[600px]">
        <ChipRow>
          {SAMPLE_CATEGORIES.map((c) => (
            <Chip key={c} active={active === c} onClick={() => setActive(c)}>
              {c}
            </Chip>
          ))}
        </ChipRow>
        <p className="mt-4 text-sm text-fg-40">Selected: {active}</p>
      </div>
    );
  },
};

/**
 * The applied-filter summary. Each chip removes the choice it names, and its
 * accessible name says so — a row that announces "Live, button" three times
 * over is unusable by ear.
 */
export const Removable: Story = {
  parameters: { layout: 'padded' },
  render: function RemovableStory() {
    const [applied, setApplied] = useState<readonly string[]>(['Live', 'Games', 'Handmade']);

    return (
      <div className="w-[600px]">
        <ChipRow fadeEdge={false} aria-label="Applied filters">
          {applied.map((filter) => (
            <RemovableChip
              key={filter}
              removeLabel={`Remove filter: ${filter}`}
              onClick={() => setApplied((current) => current.filter((f) => f !== filter))}
            >
              {filter}
            </RemovableChip>
          ))}
        </ChipRow>
        {applied.length === 0 && <p className="mt-4 text-sm text-fg-40">No filters applied.</p>}
      </div>
    );
  },
};

export const WithIconAndCount: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <ChipRow fadeEdge={false}>
      <Chip active count={2534}>
        Live
      </Chip>
      <Chip count={11054}>Upcoming</Chip>
      <Chip count={4736}>Late pledge</Chip>
      <Chip icon={<Flame className="size-3.5 text-hot" />}>Trending</Chip>
    </ChipRow>
  ),
};
