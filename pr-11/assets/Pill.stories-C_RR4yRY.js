import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-BAOL84Gu.js";import{n,t as r}from"./createLucideIcon-Dt26CPFm.js";import{n as i,t as a}from"./heart-CgxLuYBd.js";import{n as o,t as s}from"./Pill-epyXvU18.js";var c,l;function u(){return(u=e((()=>{n(),c=[[`path`,{d:`M5 12h14`,key:`1ays0h`}],[`path`,{d:`m12 5 7 7-7 7`,key:`xquz4c`}]],l=r(`arrow-right`,c)})))()}var d,f;function p(){return(p=e((()=>{n(),d=[[`path`,{d:`M5 12h14`,key:`1ays0h`}],[`path`,{d:`M12 5v14`,key:`s699le`}]],f=r(`plus`,d)})))()}var m,h,g,_,v,y,b,x;function S(){return(S=e((()=>{u(),i(),p(),o(),m=t(),h={title:`Primitives/Pill`,component:s,parameters:{docs:{description:{component:"`accent` (lime) is the URGENT action. **At most one per screen** — beyond that, urgency stops meaning anything."}}},argTypes:{variant:{control:`inline-radio`,options:[`primary`,`accent`,`ghost`,`outline`,`danger`]},size:{control:`inline-radio`,options:[`sm`,`md`,`lg`]},disabled:{control:`boolean`},fullWidth:{control:`boolean`}},args:{children:`Back this project`}},g={args:{variant:`primary`,size:`md`}},_={parameters:{layout:`padded`},render:()=>(0,m.jsxs)(`div`,{className:`flex flex-wrap items-center gap-3`,children:[(0,m.jsx)(s,{variant:`primary`,children:`Primary`}),(0,m.jsx)(s,{variant:`accent`,children:`Accent — urgent`}),(0,m.jsx)(s,{variant:`ghost`,children:`Ghost`}),(0,m.jsx)(s,{variant:`outline`,children:`Outline`}),(0,m.jsx)(s,{variant:`danger`,children:`Danger`}),(0,m.jsx)(s,{variant:`primary`,disabled:!0,children:`Disabled`})]})},v={parameters:{layout:`padded`},render:()=>(0,m.jsxs)(`div`,{className:`flex flex-wrap items-center gap-3`,children:[(0,m.jsx)(s,{size:`sm`,children:`Small`}),(0,m.jsx)(s,{size:`md`,children:`Medium`}),(0,m.jsx)(s,{size:`lg`,children:`Large`})]})},y={parameters:{layout:`padded`},render:()=>(0,m.jsxs)(`div`,{className:`flex flex-wrap items-center gap-3`,children:[(0,m.jsx)(s,{iconLeft:(0,m.jsx)(f,{className:`size-4`}),children:`New project`}),(0,m.jsx)(s,{variant:`accent`,iconRight:(0,m.jsx)(l,{className:`size-4`}),children:`Back it`}),(0,m.jsx)(s,{variant:`ghost`,iconLeft:(0,m.jsx)(a,{className:`size-4`}),children:`Save`})]})},b={parameters:{layout:`padded`},render:()=>(0,m.jsxs)(`div`,{className:`w-[420px] rounded-xl border border-white/8 bg-surface-2 p-6`,children:[(0,m.jsx)(`div`,{className:`font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums`,children:`1,111,561`}),(0,m.jsx)(`div`,{className:`mt-1 text-sm text-white/64`,children:`pledged of 100,000 goal`}),(0,m.jsxs)(`div`,{className:`mt-5 flex gap-2`,children:[(0,m.jsx)(s,{variant:`accent`,fullWidth:!0,children:`Back this project`}),(0,m.jsx)(s,{variant:`ghost`,iconLeft:(0,m.jsx)(a,{className:`size-4`}),"aria-label":`Save`,children:(0,m.jsx)(`span`,{className:`sr-only`,children:`Save`})})]})]})},x=[`Playground`,`Variants`,`Sizes`,`WithIcons`,`InContext`],g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: {
    variant: 'primary',
    size: 'md'
  }
}`,...g.parameters?.docs?.source}}},_.parameters={..._.parameters,docs:{..._.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="flex flex-wrap items-center gap-3">
      <Pill variant="primary">Primary</Pill>
      <Pill variant="accent">Accent — urgent</Pill>
      <Pill variant="ghost">Ghost</Pill>
      <Pill variant="outline">Outline</Pill>
      <Pill variant="danger">Danger</Pill>
      <Pill variant="primary" disabled>
        Disabled
      </Pill>
    </div>
}`,..._.parameters?.docs?.source}}},v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="flex flex-wrap items-center gap-3">
      <Pill size="sm">Small</Pill>
      <Pill size="md">Medium</Pill>
      <Pill size="lg">Large</Pill>
    </div>
}`,...v.parameters?.docs?.source}}},y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="flex flex-wrap items-center gap-3">
      <Pill iconLeft={<Plus className="size-4" />}>New project</Pill>
      <Pill variant="accent" iconRight={<ArrowRight className="size-4" />}>
        Back it
      </Pill>
      <Pill variant="ghost" iconLeft={<Heart className="size-4" />}>
        Save
      </Pill>
    </div>
}`,...y.parameters?.docs?.source}}},b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="w-[420px] rounded-xl border border-white/8 bg-surface-2 p-6">
      <div className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums">
        1,111,561
      </div>
      <div className="mt-1 text-sm text-white/64">pledged of 100,000 goal</div>
      <div className="mt-5 flex gap-2">
        <Pill variant="accent" fullWidth>
          Back this project
        </Pill>
        <Pill variant="ghost" iconLeft={<Heart className="size-4" />} aria-label="Save">
          <span className="sr-only">Save</span>
        </Pill>
      </div>
    </div>
}`,...b.parameters?.docs?.source},description:{story:`Realistic pairing: one accent action, one quiet action.`,...b.parameters?.docs?.description}}}})))()}S();export{b as InContext,g as Playground,v as Sizes,_ as Variants,y as WithIcons,x as __namedExportsOrder,h as default};