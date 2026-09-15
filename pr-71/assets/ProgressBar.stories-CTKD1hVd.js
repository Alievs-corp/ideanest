import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-C4KUzqtf.js";import{n,t as r}from"./ProgressBar-ChWM6h2b.js";var i,a,o,s,c;function l(){return(l=e((()=>{n(),i=t(),a={title:`Primitives/ProgressBar`,component:r,parameters:{layout:`padded`,docs:{description:{component:`At 100% the fill switches from **lime to success** and picks up a glow. Lime means "in progress"; success means "achieved".`}}},argTypes:{value:{control:{type:`range`,min:0,max:150,step:1}}}},o={args:{value:64},render:e=>(0,i.jsxs)(`div`,{className:`w-[420px]`,children:[(0,i.jsx)(r,{...e}),(0,i.jsxs)(`div`,{className:`mt-2 text-sm tabular-nums`,children:[e.value,`%`]})]})},s={args:{value:0},render:()=>(0,i.jsx)(`div`,{className:`flex w-[420px] flex-col gap-6`,children:[12,45,87,100,1111].map(e=>(0,i.jsxs)(`div`,{children:[(0,i.jsxs)(`div`,{className:`mb-2 flex items-baseline justify-between`,children:[(0,i.jsxs)(`span`,{className:`text-sm font-medium tabular-nums`,children:[e.toLocaleString(`en-US`),`%`]}),(0,i.jsx)(`span`,{className:`text-xs text-white/40`,children:e>=100?`Goal reached`:`In progress`})]}),(0,i.jsx)(r,{value:e})]},e))})},c=[`Playground`,`States`],o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    value: 64
  },
  render: args => <div className="w-[420px]">
      <ProgressBar {...args} />
      <div className="mt-2 text-sm tabular-nums">{args.value}%</div>
    </div>
}`,...o.parameters?.docs?.source}}},s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    value: 0
  },
  render: () => <div className="flex w-[420px] flex-col gap-6">
      {[12, 45, 87, 100, 1111].map(v => <div key={v}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium tabular-nums">{v.toLocaleString('en-US')}%</span>
            <span className="text-xs text-white/40">
              {v >= 100 ? 'Goal reached' : 'In progress'}
            </span>
          </div>
          <ProgressBar value={v} />
        </div>)}
    </div>
}`,...s.parameters?.docs?.source}}}})))()}l();export{o as Playground,s as States,c as __namedExportsOrder,a as default};