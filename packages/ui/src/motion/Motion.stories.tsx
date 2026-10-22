import type { Meta, StoryObj } from '@storybook/react-vite';
import { FadeUp, StaggerGroup } from './FadeUp';
import { FlipButton } from './FlipButton';
import { CountUp } from './CountUp';
import { Card, CardTitle, CardSubtitle } from '../components/Card/Card';
import { StatRow } from '../components/StatBlock/StatBlock';
import { SAMPLE_PROJECTS } from '../sample-data';

const meta = {
  title: 'Motion/Primitives',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'There is exactly **one** scroll-entry animation in the system. Restraint is what makes motion read as calm rather than busy. See `docs/motion-system.md`.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Scroll the preview pane to retrigger. It plays once and never replays. */
export const FadeUpOnScroll: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-64">
        Scroll down. Each card enters once and stays put on scroll-back.
      </p>
      <div className="h-[420px]" />
      {SAMPLE_PROJECTS.slice(0, 3).map((p) => (
        <FadeUp key={p.id}>
          <Card className="w-80">
            <CardTitle>{p.title}</CardTitle>
            <CardSubtitle>{p.creator}</CardSubtitle>
          </Card>
        </FadeUp>
      ))}
    </div>
  ),
};

/** 50ms between children, capped so long lists never crawl. */
export const Stagger: Story = {
  render: () => (
    <StaggerGroup as="ul" className="flex flex-col gap-3">
      {SAMPLE_PROJECTS.map((p) => (
        <FadeUp key={p.id} as="li" child>
          <Card className="w-80">
            <CardTitle>{p.title}</CardTitle>
            <CardSubtitle>
              {p.creator} · {p.category}
            </CardSubtitle>
          </Card>
        </FadeUp>
      ))}
    </StaggerGroup>
  ),
};

/** Hover to see the label rotate away while its duplicate rotates in. */
export const Flip: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <FlipButton label="Back this project" variant="accent" />
        <FlipButton label="Start a project" variant="primary" />
        <FlipButton label="Learn more" variant="outline" />
        <FlipButton label="Save" variant="ghost" size="sm" />
      </div>
      <p className="max-w-md text-sm text-fg-64">
        The duplicate label is <code>aria-hidden</code>. Without it every screen reader announces
        the button twice.
      </p>
    </div>
  ),
};

/** 800ms, not two seconds — a pledge total that crawls reads as "still loading". */
export const Counters: Story = {
  render: () => (
    <StatRow>
      <div className="flex flex-col gap-1">
        <span className="font-display text-[clamp(2.5rem,2rem+2.2vw,4rem)] leading-none font-semibold tracking-[-0.04em]">
          <CountUp to={1111561} />
        </span>
        <span className="text-sm text-fg-64">pledged</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-display text-3xl leading-none font-semibold tracking-[-0.04em]">
          <CountUp to={1697} />
        </span>
        <span className="text-sm text-fg-64">backers</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-display text-3xl leading-none font-semibold tracking-[-0.04em]">
          <CountUp to={1111} suffix="%" />
        </span>
        <span className="text-sm text-fg-64">funded</span>
      </div>
    </StatRow>
  ),
};
