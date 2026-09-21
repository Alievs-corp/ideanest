import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-CDLF_-s5.js";import{n as r,t as i}from"./flame-Ckt-n0ul.js";import{i as a,n as o,r as s,t as c}from"./Chip-Dgy8Us2c.js";import{a as l,t as u}from"./sample-data-6f0rXx-Z.js";var d,f,p,m,h,g,_,v,y,b;function x(){return(x=e((()=>{d=n(),r(),a(),l(),f=t(),p={title:`Primitives/Chip`,component:c,parameters:{docs:{description:{component:`The selected state is **white**, not lime — "urgent" is meaningless for a filter.`}}},args:{children:`Technology`}},m={args:{active:!1}},h={args:{active:!0}},g={args:{count:24}},_={parameters:{layout:`padded`},render:function(){let[e,t]=(0,d.useState)(`All`);return(0,f.jsxs)(`div`,{className:`w-[600px]`,children:[(0,f.jsx)(o,{children:u.map(n=>(0,f.jsx)(c,{active:e===n,onClick:()=>t(n),children:n},n))}),(0,f.jsxs)(`p`,{className:`mt-4 text-sm text-white/40`,children:[`Selected: `,e]})]})}},v={parameters:{layout:`padded`},render:function(){let[e,t]=(0,d.useState)([`Live`,`Games`,`Handmade`]);return(0,f.jsxs)(`div`,{className:`w-[600px]`,children:[(0,f.jsx)(o,{fadeEdge:!1,"aria-label":`Applied filters`,children:e.map(e=>(0,f.jsx)(s,{removeLabel:`Remove filter: ${e}`,onClick:()=>t(t=>t.filter(t=>t!==e)),children:e},e))}),e.length===0&&(0,f.jsx)(`p`,{className:`mt-4 text-sm text-white/40`,children:`No filters applied.`})]})}},y={parameters:{layout:`padded`},render:()=>(0,f.jsxs)(o,{fadeEdge:!1,children:[(0,f.jsx)(c,{active:!0,count:2534,children:`Live`}),(0,f.jsx)(c,{count:11054,children:`Upcoming`}),(0,f.jsx)(c,{count:4736,children:`Late pledge`}),(0,f.jsx)(c,{icon:(0,f.jsx)(i,{className:`size-3.5 text-hot`}),children:`Trending`})]})},b=[`Default`,`Active`,`WithCount`,`Row`,`Removable`,`WithIconAndCount`],m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    active: false
  }
}`,...m.parameters?.docs?.source}}},h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    active: true
  }
}`,...h.parameters?.docs?.source}}},g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: {
    count: 24
  }
}`,...g.parameters?.docs?.source}}},_.parameters={..._.parameters,docs:{..._.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: function RowStory() {
    const [active, setActive] = useState<string>('All');
    return <div className="w-[600px]">
        <ChipRow>
          {SAMPLE_CATEGORIES.map(c => <Chip key={c} active={active === c} onClick={() => setActive(c)}>
              {c}
            </Chip>)}
        </ChipRow>
        <p className="mt-4 text-sm text-white/40">Selected: {active}</p>
      </div>;
  }
}`,..._.parameters?.docs?.source},description:{story:`Horizontally scrolling filter row with a fading right edge.`,..._.parameters?.docs?.description}}},v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: function RemovableStory() {
    const [applied, setApplied] = useState<readonly string[]>(['Live', 'Games', 'Handmade']);
    return <div className="w-[600px]">
        <ChipRow fadeEdge={false} aria-label="Applied filters">
          {applied.map(filter => <RemovableChip key={filter} removeLabel={\`Remove filter: \${filter}\`} onClick={() => setApplied(current => current.filter(f => f !== filter))}>
              {filter}
            </RemovableChip>)}
        </ChipRow>
        {applied.length === 0 && <p className="mt-4 text-sm text-white/40">No filters applied.</p>}
      </div>;
  }
}`,...v.parameters?.docs?.source},description:{story:`The applied-filter summary. Each chip removes the choice it names, and its
accessible name says so — a row that announces "Live, button" three times
over is unusable by ear.`,...v.parameters?.docs?.description}}},y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: () => <ChipRow fadeEdge={false}>
      <Chip active count={2534}>
        Live
      </Chip>
      <Chip count={11054}>Upcoming</Chip>
      <Chip count={4736}>Late pledge</Chip>
      <Chip icon={<Flame className="size-3.5 text-hot" />}>Trending</Chip>
    </ChipRow>
}`,...y.parameters?.docs?.source}}}})))()}x();export{h as Active,m as Default,v as Removable,_ as Row,g as WithCount,y as WithIconAndCount,b as __namedExportsOrder,p as default};