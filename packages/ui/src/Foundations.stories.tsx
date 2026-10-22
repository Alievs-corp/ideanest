import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Swatch({ name, varName, note }: { name: string; varName: string; note?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="size-14 shrink-0 rounded-md border border-fg/8"
        style={{ background: `var(${varName})` }}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <code className="text-xs text-fg-40">{varName}</code>
        {note && <div className="mt-0.5 text-xs text-fg-64">{note}</div>}
      </div>
    </div>
  );
}

export const Colors: Story = {
  render: () => (
    <div className="flex max-w-4xl flex-col gap-10">
      <section>
        <h2 className="mb-1 text-2xl font-semibold tracking-tight">Surfaces</h2>
        <p className="mb-5 text-sm text-fg-64">
          Depth comes from surface colour, not shadow.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Swatch name="surface-1" varName="--surface-1" note="Page background" />
          <Swatch name="surface-2" varName="--surface-2" note="Standard card" />
          <Swatch name="surface-3" varName="--surface-3" note="Nested block" />
          <Swatch name="surface-4" varName="--surface-4" note="Hover, selected" />
          <Swatch name="white" varName="--white-surface" note="Floating panel — ACCENT" />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-2xl font-semibold tracking-tight">Lime — brand accent</h2>
        <p className="mb-5 text-sm text-fg-64">
          Lime means <strong className="text-lime-500">urgency</strong>, not success. Success has
          its own token: <code className="text-success">--success</code>.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Swatch name="lime-300" varName="--lime-300" />
          <Swatch name="lime-400" varName="--lime-400" note="Hover" />
          <Swatch name="lime-500" varName="--lime-500" note="Primary" />
          <Swatch name="lime-600" varName="--lime-600" note="Pressed" />
          <Swatch name="lime-700" varName="--lime-700" note="Border, icon" />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-lime-500 p-4 text-on-lime">
            <div className="text-sm font-semibold">Correct — 15.8:1</div>
            <div className="mt-1 text-sm opacity-70">Lime surface, near-black text</div>
          </div>
          <div className="rounded-lg border border-danger/40 bg-white p-4">
            <div className="text-sm font-semibold text-lime-500">Wrong — 1.3:1</div>
            <div className="mt-1 text-sm text-on-white/64">
              Lime text on white. Unreadable. Never do this.
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-2xl font-semibold tracking-tight">Status</h2>
        <p className="mb-5 text-sm text-fg-64">
          Colour alone must never carry meaning — pair it with an icon and a label.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Swatch name="success" varName="--success" note="Goal reached" />
          <Swatch name="warning" varName="--warning" note="Final 48 hours" />
          <Swatch name="danger" varName="--danger" note="Payment failed" />
          <Swatch name="info" varName="--info" note="In review" />
          <Swatch name="hot" varName="--hot" note="Trending" />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-2xl font-semibold tracking-tight">Text</h2>
        <p className="mb-5 text-sm text-fg-64">
          Contrast ratios measured against surface-1.
        </p>
        <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-5">
          <p className="text-fg">text-primary — 20.4:1 · AAA</p>
          <p className="text-fg-64">text-secondary — 9.2:1 · AAA</p>
          <p className="text-fg-40">text-tertiary — 4.9:1 · AA at 16px and above</p>
          <p className="text-reading leading-[1.75]">
            text-reading — long-form campaign copy. Under pure white, so halation is reduced.
          </p>
        </div>
      </section>
    </div>
  ),
};

export const Radius: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      {(
        [
          ['sm — 10px', 'rounded-sm', 'Tag, thumbnail'],
          ['md — 14px', 'rounded-md', 'Nested block, input'],
          ['lg — 20px', 'rounded-lg', 'Project card'],
          ['xl — 28px', 'rounded-xl', 'Panel, modal'],
          ['full', 'rounded-full', 'Pill, chip, avatar'],
        ] as const
      ).map(([label, cls, note]) => (
        <div key={label} className="flex flex-col items-center gap-2">
          <div className={`size-24 border border-fg/8 bg-surface-3 ${cls}`} />
          <div className="text-center">
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-fg-40">{note}</div>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Typography: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-fg-64">
        Letter-spacing tightens as size grows. Skipping this is what makes large headings look
        cheap.
      </p>
      <div className="font-display text-[clamp(2.5rem,2rem+2.2vw,4rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums">
        1,111,561
      </div>
      <div className="font-display text-5xl font-semibold tracking-[-0.035em]">Display / H1</div>
      <div className="font-display text-3xl font-semibold tracking-[-0.03em]">Heading H2</div>
      <div className="text-lg font-medium tracking-[-0.02em]">Card title — 18px / 500</div>
      <div className="text-base text-fg-64">
        Body copy — 16px / 400. Latin extended check: ə ğ ı ö ş ü ç İ Ə Ğ Ö Ş Ü Ç
      </div>
      <div className="text-sm text-fg-64">Subtitle — 14px</div>
      <div className="text-xs text-fg-40">Meta / tag — 12px</div>
    </div>
  ),
};
