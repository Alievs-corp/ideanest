import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, CardTitle, CardSubtitle, CardFooter } from './Card';
import { Tag } from '../Tag/Tag';
import { Avatar } from '../Avatar/Avatar';
import { DotIndicator } from '../DotIndicator/DotIndicator';
import { ExpandButton } from '../IconButton/ExpandButton';
import { ProgressBar } from '../ProgressBar/ProgressBar';

const meta = {
  title: 'Primitives/Card',
  component: Card,
  parameters: {
    docs: {
      description: {
        component:
          'Three variants at the same size, encoding **state** rather than elevation. `active` (lime) means URGENT, not successful.',
      },
    },
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'active', 'floating'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    interactive: { control: 'boolean' },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { variant: 'default', size: 'md', interactive: false },
  render: (args) => (
    <Card {...args} className="w-80">
      <CardTitle>Pomegranate Portable Battery</CardTitle>
      <CardSubtitle>Elias Nordin</CardSubtitle>
      <CardFooter>
        <Tag>Technology</Tag>
        <Tag>Tallinn</Tag>
      </CardFooter>
    </Card>
  ),
};

export const Variants: Story = {
  args: {},
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-wrap items-start gap-4">
      <Card className="w-72">
        <CardTitle>Standard card</CardTitle>
        <CardSubtitle>surface-2 · ordinary item</CardSubtitle>
      </Card>

      <Card variant="active" className="w-72">
        <CardTitle>Active card</CardTitle>
        <CardSubtitle onLime>lime-500 · closes in two days</CardSubtitle>
      </Card>

      <Card variant="floating" className="w-72">
        <CardTitle>Floating panel</CardTitle>
        <p className="mt-0.5 text-sm text-on-white/64">white · modal, checkout</p>
      </Card>
    </div>
  ),
};

/** Composed project card — the densest use of the primitive. */
export const ProjectCard: Story = {
  args: {},
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Card interactive className="group w-[300px]">
        <ExpandButton label="Open project" />
        <Avatar name="Amara Osei" />
        <CardTitle className="mt-3">Woven Archive</CardTitle>
        <CardSubtitle>Amara Osei · Art</CardSubtitle>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-fg-40">Funding</span>
          <DotIndicator percent={87} />
        </div>
        <ProgressBar value={87} className="mt-2" />
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-medium tabular-nums">87%</span>
          <span className="text-xs text-fg-40">12 days left</span>
        </div>
        <CardFooter>
          <Tag>Art</Tag>
          <Tag>Lisbon</Tag>
        </CardFooter>
      </Card>

      <Card variant="active" interactive className="group w-[300px]">
        <ExpandButton label="Open project" onLime />
        <Avatar name="Rowan Hale" />
        <CardTitle className="mt-3">Starfall Tabletop Game</CardTitle>
        <CardSubtitle onLime>Rowan Hale · Games</CardSubtitle>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-on-lime/50">Closing</span>
          <DotIndicator percent={143} onLime />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-on-lime/15">
          <div className="h-full w-full rounded-full bg-on-lime" />
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-semibold tabular-nums">143%</span>
          <span className="text-xs font-medium text-on-lime/70">6 hours left</span>
        </div>
        <CardFooter>
          <Tag variant="onLime">Games</Tag>
          <Tag variant="onLime">Bristol</Tag>
        </CardFooter>
      </Card>
    </div>
  ),
};
