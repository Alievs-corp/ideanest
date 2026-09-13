import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-BdYQlg6M.js";function n({name:e,varName:t,note:n}){return(0,r.jsxs)(`div`,{className:`flex items-center gap-3`,children:[(0,r.jsx)(`div`,{className:`size-14 shrink-0 rounded-md border border-white/8`,style:{background:`var(${t})`}}),(0,r.jsxs)(`div`,{className:`min-w-0`,children:[(0,r.jsx)(`div`,{className:`text-sm font-medium`,children:e}),(0,r.jsx)(`code`,{className:`text-xs text-white/40`,children:t}),n&&(0,r.jsx)(`div`,{className:`mt-0.5 text-xs text-white/64`,children:n})]})]})}var r,i,a,o,s,c;function l(){return(l=e((()=>{r=t(),i={title:`Foundations/Tokens`,parameters:{layout:`padded`}},a={render:()=>(0,r.jsxs)(`div`,{className:`flex max-w-4xl flex-col gap-10`,children:[(0,r.jsxs)(`section`,{children:[(0,r.jsx)(`h2`,{className:`mb-1 text-2xl font-semibold tracking-tight`,children:`Surfaces`}),(0,r.jsx)(`p`,{className:`mb-5 text-sm text-white/64`,children:`Depth comes from surface colour, not shadow.`}),(0,r.jsxs)(`div`,{className:`grid grid-cols-2 gap-4 sm:grid-cols-3`,children:[(0,r.jsx)(n,{name:`surface-1`,varName:`--surface-1`,note:`Page background`}),(0,r.jsx)(n,{name:`surface-2`,varName:`--surface-2`,note:`Standard card`}),(0,r.jsx)(n,{name:`surface-3`,varName:`--surface-3`,note:`Nested block`}),(0,r.jsx)(n,{name:`surface-4`,varName:`--surface-4`,note:`Hover, selected`}),(0,r.jsx)(n,{name:`white`,varName:`--white-surface`,note:`Floating panel — ACCENT`})]})]}),(0,r.jsxs)(`section`,{children:[(0,r.jsx)(`h2`,{className:`mb-1 text-2xl font-semibold tracking-tight`,children:`Lime — brand accent`}),(0,r.jsxs)(`p`,{className:`mb-5 text-sm text-white/64`,children:[`Lime means `,(0,r.jsx)(`strong`,{className:`text-lime-500`,children:`urgency`}),`, not success. Success has its own token: `,(0,r.jsx)(`code`,{className:`text-success`,children:`--success`}),`.`]}),(0,r.jsxs)(`div`,{className:`grid grid-cols-2 gap-4 sm:grid-cols-3`,children:[(0,r.jsx)(n,{name:`lime-300`,varName:`--lime-300`}),(0,r.jsx)(n,{name:`lime-400`,varName:`--lime-400`,note:`Hover`}),(0,r.jsx)(n,{name:`lime-500`,varName:`--lime-500`,note:`Primary`}),(0,r.jsx)(n,{name:`lime-600`,varName:`--lime-600`,note:`Pressed`}),(0,r.jsx)(n,{name:`lime-700`,varName:`--lime-700`,note:`Border, icon`})]}),(0,r.jsxs)(`div`,{className:`mt-6 grid gap-3 sm:grid-cols-2`,children:[(0,r.jsxs)(`div`,{className:`rounded-lg bg-lime-500 p-4 text-on-lime`,children:[(0,r.jsx)(`div`,{className:`text-sm font-semibold`,children:`Correct — 15.8:1`}),(0,r.jsx)(`div`,{className:`mt-1 text-sm opacity-70`,children:`Lime surface, near-black text`})]}),(0,r.jsxs)(`div`,{className:`rounded-lg border border-danger/40 bg-white p-4`,children:[(0,r.jsx)(`div`,{className:`text-sm font-semibold text-lime-500`,children:`Wrong — 1.3:1`}),(0,r.jsx)(`div`,{className:`mt-1 text-sm text-on-white/64`,children:`Lime text on white. Unreadable. Never do this.`})]})]})]}),(0,r.jsxs)(`section`,{children:[(0,r.jsx)(`h2`,{className:`mb-1 text-2xl font-semibold tracking-tight`,children:`Status`}),(0,r.jsx)(`p`,{className:`mb-5 text-sm text-white/64`,children:`Colour alone must never carry meaning — pair it with an icon and a label.`}),(0,r.jsxs)(`div`,{className:`grid grid-cols-2 gap-4 sm:grid-cols-3`,children:[(0,r.jsx)(n,{name:`success`,varName:`--success`,note:`Goal reached`}),(0,r.jsx)(n,{name:`warning`,varName:`--warning`,note:`Final 48 hours`}),(0,r.jsx)(n,{name:`danger`,varName:`--danger`,note:`Payment failed`}),(0,r.jsx)(n,{name:`info`,varName:`--info`,note:`In review`}),(0,r.jsx)(n,{name:`hot`,varName:`--hot`,note:`Trending`})]})]}),(0,r.jsxs)(`section`,{children:[(0,r.jsx)(`h2`,{className:`mb-1 text-2xl font-semibold tracking-tight`,children:`Text`}),(0,r.jsx)(`p`,{className:`mb-5 text-sm text-white/64`,children:`Contrast ratios measured against surface-1.`}),(0,r.jsxs)(`div`,{className:`flex flex-col gap-2 rounded-lg bg-surface-2 p-5`,children:[(0,r.jsx)(`p`,{className:`text-white`,children:`text-primary — 20.4:1 · AAA`}),(0,r.jsx)(`p`,{className:`text-white/64`,children:`text-secondary — 9.2:1 · AAA`}),(0,r.jsx)(`p`,{className:`text-white/40`,children:`text-tertiary — 4.9:1 · AA at 16px and above`}),(0,r.jsx)(`p`,{className:`text-reading leading-[1.75]`,children:`text-reading — long-form campaign copy. Under pure white, so halation is reduced.`})]})]})]})},o={render:()=>(0,r.jsx)(`div`,{className:`flex flex-wrap gap-6`,children:[[`sm — 10px`,`rounded-sm`,`Tag, thumbnail`],[`md — 14px`,`rounded-md`,`Nested block, input`],[`lg — 20px`,`rounded-lg`,`Project card`],[`xl — 28px`,`rounded-xl`,`Panel, modal`],[`full`,`rounded-full`,`Pill, chip, avatar`]].map(([e,t,n])=>(0,r.jsxs)(`div`,{className:`flex flex-col items-center gap-2`,children:[(0,r.jsx)(`div`,{className:`size-24 border border-white/8 bg-surface-3 ${t}`}),(0,r.jsxs)(`div`,{className:`text-center`,children:[(0,r.jsx)(`div`,{className:`text-sm font-medium`,children:e}),(0,r.jsx)(`div`,{className:`text-xs text-white/40`,children:n})]})]},e))})},s={render:()=>(0,r.jsxs)(`div`,{className:`flex max-w-3xl flex-col gap-6`,children:[(0,r.jsx)(`p`,{className:`text-sm text-white/64`,children:`Letter-spacing tightens as size grows. Skipping this is what makes large headings look cheap.`}),(0,r.jsx)(`div`,{className:`font-display text-[clamp(2.5rem,2rem+2.2vw,4rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums`,children:`1,111,561`}),(0,r.jsx)(`div`,{className:`font-display text-5xl font-semibold tracking-[-0.035em]`,children:`Display / H1`}),(0,r.jsx)(`div`,{className:`font-display text-3xl font-semibold tracking-[-0.03em]`,children:`Heading H2`}),(0,r.jsx)(`div`,{className:`text-lg font-medium tracking-[-0.02em]`,children:`Card title — 18px / 500`}),(0,r.jsx)(`div`,{className:`text-base text-white/64`,children:`Body copy — 16px / 400. Latin extended check: ə ğ ı ö ş ü ç İ Ə Ğ Ö Ş Ü Ç`}),(0,r.jsx)(`div`,{className:`text-sm text-white/64`,children:`Subtitle — 14px`}),(0,r.jsx)(`div`,{className:`text-xs text-white/40`,children:`Meta / tag — 12px`})]})},c=[`Colors`,`Radius`,`Typography`],a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex max-w-4xl flex-col gap-10">
      <section>
        <h2 className="mb-1 text-2xl font-semibold tracking-tight">Surfaces</h2>
        <p className="mb-5 text-sm text-white/64">
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
        <p className="mb-5 text-sm text-white/64">
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
        <p className="mb-5 text-sm text-white/64">
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
        <p className="mb-5 text-sm text-white/64">
          Contrast ratios measured against surface-1.
        </p>
        <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-5">
          <p className="text-white">text-primary — 20.4:1 · AAA</p>
          <p className="text-white/64">text-secondary — 9.2:1 · AAA</p>
          <p className="text-white/40">text-tertiary — 4.9:1 · AA at 16px and above</p>
          <p className="text-reading leading-[1.75]">
            text-reading — long-form campaign copy. Under pure white, so halation is reduced.
          </p>
        </div>
      </section>
    </div>
}`,...a.parameters?.docs?.source}}},o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-wrap gap-6">
      {([['sm — 10px', 'rounded-sm', 'Tag, thumbnail'], ['md — 14px', 'rounded-md', 'Nested block, input'], ['lg — 20px', 'rounded-lg', 'Project card'], ['xl — 28px', 'rounded-xl', 'Panel, modal'], ['full', 'rounded-full', 'Pill, chip, avatar']] as const).map(([label, cls, note]) => <div key={label} className="flex flex-col items-center gap-2">
          <div className={\`size-24 border border-white/8 bg-surface-3 \${cls}\`} />
          <div className="text-center">
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-white/40">{note}</div>
          </div>
        </div>)}
    </div>
}`,...o.parameters?.docs?.source}}},s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-white/64">
        Letter-spacing tightens as size grows. Skipping this is what makes large headings look
        cheap.
      </p>
      <div className="font-display text-[clamp(2.5rem,2rem+2.2vw,4rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums">
        1,111,561
      </div>
      <div className="font-display text-5xl font-semibold tracking-[-0.035em]">Display / H1</div>
      <div className="font-display text-3xl font-semibold tracking-[-0.03em]">Heading H2</div>
      <div className="text-lg font-medium tracking-[-0.02em]">Card title — 18px / 500</div>
      <div className="text-base text-white/64">
        Body copy — 16px / 400. Latin extended check: ə ğ ı ö ş ü ç İ Ə Ğ Ö Ş Ü Ç
      </div>
      <div className="text-sm text-white/64">Subtitle — 14px</div>
      <div className="text-xs text-white/40">Meta / tag — 12px</div>
    </div>
}`,...s.parameters?.docs?.source}}}})))()}l();export{a as Colors,o as Radius,s as Typography,c as __namedExportsOrder,i as default};