import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Compass, LayoutGrid, MessageSquare, Search, Settings, User } from 'lucide-react';
import { Rail, RailItem } from './Rail';
import { TopBar, TopBarLink } from './TopBar';
import { Timeline } from './Timeline';
import { Pill } from '../components/Pill/Pill';
import { Avatar } from '../components/Avatar/Avatar';
import { IconButton } from '../components/IconButton/IconButton';

const meta = {
  title: 'Layout/Shell',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const NavigationRail: Story = {
  render: () => (
    <div className="flex h-[520px] bg-surface-1">
      <Rail
        header={
          <div className="grid size-9 place-items-center rounded-lg bg-lime-500 font-display text-sm font-bold text-on-lime">
            IN
          </div>
        }
        footer={<Avatar name="Amara Osei" size="sm" />}
      >
        <RailItem icon={<Compass />} label="Discover" active />
        <RailItem icon={<LayoutGrid />} label="My projects" />
        <RailItem icon={<MessageSquare />} label="Messages" badge />
        <RailItem icon={<Bell />} label="Notifications" />
        <RailItem icon={<Settings />} label="Settings" />
      </Rail>
      <div className="flex-1 p-8">
        <p className="text-sm text-white/64">
          The active item is a lime <em>icon</em>, never a lime surface. Permanent chrome should not
          shout as loudly as a campaign about to close.
        </p>
      </div>
    </div>
  ),
};

/**
 * Toggle `forceScrolled` in the controls to compare states without scrolling.
 */
export const CollapsingTopBar: Story = {
  render: () => (
    <div className="min-h-[520px] bg-surface-1">
      <TopBar
        forceScrolled={false}
        logo={<span className="font-display text-lg font-semibold">IdeyaNest</span>}
        nav={
          <>
            <TopBarLink href="#">Discover</TopBarLink>
            <TopBarLink href="#">Start a project</TopBarLink>
            <TopBarLink href="#">About</TopBarLink>
          </>
        }
        actions={<Pill size="sm">Sign in</Pill>}
      />
      <div className="px-7 py-10">
        <p className="max-w-md text-sm text-white/64">At the top of the page: transparent, wide.</p>
      </div>
    </div>
  ),
};

export const CollapsedTopBar: Story = {
  render: () => (
    <div className="min-h-[520px] bg-surface-1">
      <TopBar
        forceScrolled
        logo={<span className="font-display text-lg font-semibold">IdeyaNest</span>}
        nav={
          <>
            <TopBarLink href="#">Discover</TopBarLink>
            <TopBarLink href="#">Start a project</TopBarLink>
            <TopBarLink href="#">About</TopBarLink>
          </>
        }
        actions={
          <>
            <IconButton icon={<Search />} label="Search" size="sm" />
            <IconButton icon={<User />} label="Account" size="sm" />
          </>
        }
      />
      <div className="px-7 py-10">
        <p className="max-w-md text-sm text-white/64">
          After scrolling: the pill narrows, turns white, and padding tightens — all on the same
          300ms curve.
        </p>
      </div>
    </div>
  ),
};

const START = new Date('2026-08-01T00:00:00Z');
const END = new Date('2026-09-30T00:00:00Z');

export const CampaignTimeline: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="w-[760px] p-6">
      <Timeline
        start={START}
        end={END}
        now={new Date('2026-08-28T00:00:00Z')}
        label="Campaign timeline: 1 August to 30 September"
        markers={[
          { id: 'launch', at: START, label: 'Launched' },
          { id: 'goal', at: new Date('2026-08-19T00:00:00Z'), label: 'Goal reached' },
          { id: 'now', at: new Date('2026-08-28T00:00:00Z'), label: 'Today', isNow: true },
          { id: 'end', at: END, label: 'Closes' },
        ]}
      />
      <p className="mt-6 text-sm text-white/64">
        A lime surface is right here — a live campaign is time-bound, and the strip exists to say
        the clock is running.
      </p>
    </div>
  ),
};
