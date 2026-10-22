import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { RailHeader, CardRail } from './RailHeader';
import { Card, CardTitle, CardSubtitle, CardFooter } from '../Card/Card';
import { Chip, ChipRow } from '../Chip/Chip';
import { IconButton } from '../IconButton/IconButton';
import { ExpandButton } from '../IconButton/ExpandButton';
import { Avatar } from '../Avatar/Avatar';
import { Tag } from '../Tag/Tag';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import { DotIndicator } from '../DotIndicator/DotIndicator';
import { SAMPLE_PROJECTS, SAMPLE_CATEGORIES, type SampleProject } from '../../sample-data';

const meta = {
  title: 'Patterns/Discovery Rail',
  component: RailHeader,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RailHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

function ProjectCard({ p }: { p: SampleProject }) {
  const active = p.urgent === true;
  return (
    <Card variant={active ? 'active' : 'default'} interactive className="group w-[290px] shrink-0">
      <ExpandButton label={`Open ${p.title}`} onLime={active} />
      <Avatar name={p.creator} />
      <CardTitle className="mt-3">{p.title}</CardTitle>
      <CardSubtitle onLime={active}>{p.creator}</CardSubtitle>

      <div className="mt-4 flex items-center justify-between">
        <span className={active ? 'text-xs text-on-lime/50' : 'text-xs text-fg-40'}>
          Funding
        </span>
        <DotIndicator percent={p.percent} onLime={active} />
      </div>

      {active ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-on-lime/15">
          <div className="h-full w-full rounded-full bg-on-lime" />
        </div>
      ) : (
        <ProgressBar value={p.percent} className="mt-2" />
      )}

      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold tabular-nums">{p.percent}%</span>
        <span className={active ? 'text-xs font-medium text-on-lime/70' : 'text-xs text-fg-40'}>
          {p.daysLeft === 0 ? 'Closes today' : `${p.daysLeft} days left`}
        </span>
      </div>

      <CardFooter>
        <Tag variant={active ? 'onLime' : 'default'}>{p.category}</Tag>
        <Tag variant={active ? 'onLime' : 'default'}>{p.city}</Tag>
      </CardFooter>
    </Card>
  );
}

/**
 * Every primitive working together. This is the reference story for visual
 * regression — if the system drifts, it shows here first.
 */
export const DiscoveryRail: Story = {
  args: { title: '' },
  render: function RailStory() {
    const [filter, setFilter] = useState<string>('All');
    return (
      <div className="w-[900px] rounded-xl bg-surface-1 p-6">
        <RailHeader
          title="Closing soon"
          count={`${SAMPLE_PROJECTS.length} projects`}
          actions={
            <>
              <IconButton icon={<Search />} label="Search" size="sm" />
              <IconButton icon={<SlidersHorizontal />} label="Filter" size="sm" />
            </>
          }
          filters={
            <ChipRow>
              {SAMPLE_CATEGORIES.slice(0, 7).map((f) => (
                <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                  {f}
                </Chip>
              ))}
            </ChipRow>
          }
        />
        <CardRail className="mt-5">
          {SAMPLE_PROJECTS.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </CardRail>
      </div>
    );
  },
};
