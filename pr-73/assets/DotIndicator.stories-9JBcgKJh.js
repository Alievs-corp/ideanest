import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-C4KUzqtf.js";import{n,t as r}from"./DotIndicator-BhdGPEC1.js";var i,a,o,s,c,l;function u(){return(u=e((()=>{n(),i=t(),a={title:`Primitives/DotIndicator`,component:r,parameters:{layout:`padded`,docs:{description:{component:"This must **never be the only carrier of the information** (docs/ui-kit.md §9.4). `aria-label` states the percentage, and a numeric figure belongs beside it."}}},argTypes:{percent:{control:{type:`range`,min:0,max:150,step:1}}},args:{percent:64}},o={},s={render:()=>(0,i.jsx)(`div`,{className:`flex flex-col gap-4`,children:[0,15,40,64,88,100,143].map(e=>(0,i.jsxs)(`div`,{className:`flex items-center gap-4`,children:[(0,i.jsx)(r,{percent:e}),(0,i.jsxs)(`span`,{className:`text-sm tabular-nums text-white/64`,children:[e,`%`]})]},e))})},c={render:()=>(0,i.jsx)(`div`,{className:`flex w-72 flex-col gap-4 rounded-lg bg-lime-500 p-5`,children:[22,64,100,143].map(e=>(0,i.jsxs)(`div`,{className:`flex items-center gap-4`,children:[(0,i.jsx)(r,{percent:e,onLime:!0}),(0,i.jsxs)(`span`,{className:`text-sm tabular-nums text-on-lime/70`,children:[e,`%`]})]},e))})},l=[`Playground`,`Scale`,`OnLime`],o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{}`,...o.parameters?.docs?.source}}},s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4">
      {[0, 15, 40, 64, 88, 100, 143].map(p => <div key={p} className="flex items-center gap-4">
          <DotIndicator percent={p} />
          <span className="text-sm tabular-nums text-white/64">{p}%</span>
        </div>)}
    </div>
}`,...s.parameters?.docs?.source}}},c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex w-72 flex-col gap-4 rounded-lg bg-lime-500 p-5">
      {[22, 64, 100, 143].map(p => <div key={p} className="flex items-center gap-4">
          <DotIndicator percent={p} onLime />
          <span className="text-sm tabular-nums text-on-lime/70">{p}%</span>
        </div>)}
    </div>
}`,...c.parameters?.docs?.source},description:{story:`On a lime surface the status hues vanish, so the dots switch to near-black.`,...c.parameters?.docs?.description}}}})))()}u();export{c as OnLime,o as Playground,s as Scale,l as __namedExportsOrder,a as default};