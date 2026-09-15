import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-C4KUzqtf.js";import{r as n,t as r}from"./Avatar-DybT5fwi.js";import{a as i,i as a,n as o,r as s,t as c}from"./Card-B02bVLvK.js";import{n as l,t as u}from"./Tag-CFCuQDVc.js";import{n as d,t as f}from"./DotIndicator-BhdGPEC1.js";import{n as p,t as m}from"./ExpandButton-DPRpSwOW.js";import{n as h,t as g}from"./ProgressBar-ChWM6h2b.js";var _,v,y,b,x,S;function C(){return(C=e((()=>{i(),l(),n(),d(),p(),h(),_=t(),v={title:`Primitives/Card`,component:c,parameters:{docs:{description:{component:"Three variants at the same size, encoding **state** rather than elevation. `active` (lime) means URGENT, not successful."}}},argTypes:{variant:{control:`inline-radio`,options:[`default`,`active`,`floating`]},size:{control:`inline-radio`,options:[`sm`,`md`,`lg`]},interactive:{control:`boolean`}}},y={args:{variant:`default`,size:`md`,interactive:!1},render:e=>(0,_.jsxs)(c,{...e,className:`w-80`,children:[(0,_.jsx)(a,{children:`Pomegranate Portable Battery`}),(0,_.jsx)(s,{children:`Elias Nordin`}),(0,_.jsxs)(o,{children:[(0,_.jsx)(u,{children:`Technology`}),(0,_.jsx)(u,{children:`Tallinn`})]})]})},b={args:{},parameters:{layout:`padded`},render:()=>(0,_.jsxs)(`div`,{className:`flex flex-wrap items-start gap-4`,children:[(0,_.jsxs)(c,{className:`w-72`,children:[(0,_.jsx)(a,{children:`Standard card`}),(0,_.jsx)(s,{children:`surface-2 · ordinary item`})]}),(0,_.jsxs)(c,{variant:`active`,className:`w-72`,children:[(0,_.jsx)(a,{children:`Active card`}),(0,_.jsx)(s,{onLime:!0,children:`lime-500 · closes in two days`})]}),(0,_.jsxs)(c,{variant:`floating`,className:`w-72`,children:[(0,_.jsx)(a,{children:`Floating panel`}),(0,_.jsx)(`p`,{className:`mt-0.5 text-sm text-on-white/64`,children:`white · modal, checkout`})]})]})},x={args:{},parameters:{layout:`padded`},render:()=>(0,_.jsxs)(`div`,{className:`flex flex-wrap gap-4`,children:[(0,_.jsxs)(c,{interactive:!0,className:`group w-[300px]`,children:[(0,_.jsx)(m,{label:`Open project`}),(0,_.jsx)(r,{name:`Amara Osei`}),(0,_.jsx)(a,{className:`mt-3`,children:`Woven Archive`}),(0,_.jsx)(s,{children:`Amara Osei · Art`}),(0,_.jsxs)(`div`,{className:`mt-4 flex items-center justify-between`,children:[(0,_.jsx)(`span`,{className:`text-xs text-white/40`,children:`Funding`}),(0,_.jsx)(f,{percent:87})]}),(0,_.jsx)(g,{value:87,className:`mt-2`}),(0,_.jsxs)(`div`,{className:`mt-2 flex items-baseline justify-between`,children:[(0,_.jsx)(`span`,{className:`text-sm font-medium tabular-nums`,children:`87%`}),(0,_.jsx)(`span`,{className:`text-xs text-white/40`,children:`12 days left`})]}),(0,_.jsxs)(o,{children:[(0,_.jsx)(u,{children:`Art`}),(0,_.jsx)(u,{children:`Lisbon`})]})]}),(0,_.jsxs)(c,{variant:`active`,interactive:!0,className:`group w-[300px]`,children:[(0,_.jsx)(m,{label:`Open project`,onLime:!0}),(0,_.jsx)(r,{name:`Rowan Hale`}),(0,_.jsx)(a,{className:`mt-3`,children:`Starfall Tabletop Game`}),(0,_.jsx)(s,{onLime:!0,children:`Rowan Hale · Games`}),(0,_.jsxs)(`div`,{className:`mt-4 flex items-center justify-between`,children:[(0,_.jsx)(`span`,{className:`text-xs text-on-lime/50`,children:`Closing`}),(0,_.jsx)(f,{percent:143,onLime:!0})]}),(0,_.jsx)(`div`,{className:`mt-2 h-1.5 overflow-hidden rounded-full bg-on-lime/15`,children:(0,_.jsx)(`div`,{className:`h-full w-full rounded-full bg-on-lime`})}),(0,_.jsxs)(`div`,{className:`mt-2 flex items-baseline justify-between`,children:[(0,_.jsx)(`span`,{className:`text-sm font-semibold tabular-nums`,children:`143%`}),(0,_.jsx)(`span`,{className:`text-xs font-medium text-on-lime/70`,children:`6 hours left`})]}),(0,_.jsxs)(o,{children:[(0,_.jsx)(u,{variant:`onLime`,children:`Games`}),(0,_.jsx)(u,{variant:`onLime`,children:`Bristol`})]})]})]})},S=[`Default`,`Variants`,`ProjectCard`],y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    variant: 'default',
    size: 'md',
    interactive: false
  },
  render: args => <Card {...args} className="w-80">
      <CardTitle>Pomegranate Portable Battery</CardTitle>
      <CardSubtitle>Elias Nordin</CardSubtitle>
      <CardFooter>
        <Tag>Technology</Tag>
        <Tag>Tallinn</Tag>
      </CardFooter>
    </Card>
}`,...y.parameters?.docs?.source}}},b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  args: {},
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="flex flex-wrap items-start gap-4">
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
}`,...b.parameters?.docs?.source}}},x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  args: {},
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="flex flex-wrap gap-4">
      <Card interactive className="group w-[300px]">
        <ExpandButton label="Open project" />
        <Avatar name="Amara Osei" />
        <CardTitle className="mt-3">Woven Archive</CardTitle>
        <CardSubtitle>Amara Osei · Art</CardSubtitle>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-white/40">Funding</span>
          <DotIndicator percent={87} />
        </div>
        <ProgressBar value={87} className="mt-2" />
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-medium tabular-nums">87%</span>
          <span className="text-xs text-white/40">12 days left</span>
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
}`,...x.parameters?.docs?.source},description:{story:`Composed project card — the densest use of the primitive.`,...x.parameters?.docs?.description}}}})))()}C();export{y as Default,x as ProjectCard,b as Variants,S as __namedExportsOrder,v as default};