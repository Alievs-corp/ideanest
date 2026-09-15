import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-C4KUzqtf.js";import{n,t as r}from"./cn-Dm4OyE3Q.js";import{n as i,t as a}from"./createLucideIcon-yXg_vDnW.js";import{n as o,t as s}from"./x-Dqmrjevk.js";import{n as c,t as l}from"./IconButton-CLK1z2vs.js";import{n as u,t as d}from"./Pill-B0hOB13w.js";var f,p;function m(){return(m=e((()=>{i(),f={name:`download`,size:24,node:[[`path`,{d:`M12 15V3`,key:`m9g1x1`}],[`path`,{d:`M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`,key:`ih7n3h`}],[`path`,{d:`m7 10 5 5 5-5`,key:`brsn70`}]]},f.node,p=a(f)})))()}function h({title:e,actions:t,className:n,children:i,...a}){return(0,g.jsxs)(`div`,{className:r(`overflow-hidden rounded-xl bg-white text-on-white shadow-float`,n),...a,children:[(e||t)&&(0,g.jsxs)(`div`,{className:`flex items-center justify-between gap-4 px-5 pt-5 pb-3`,children:[typeof e==`string`?(0,g.jsx)(`h3`,{className:`text-lg font-medium tracking-[-0.02em]`,children:e}):e,t&&(0,g.jsx)(`div`,{className:`flex items-center gap-2`,children:t})]}),(0,g.jsx)(`div`,{className:`px-5 pb-5`,children:i})]})}var g;function _(){return(_=e((()=>{n(),g=t(),h.__docgenInfo={description:``,methods:[],displayName:`FloatingPanel`,props:{title:{required:!1,tsType:{name:`ReactNode`},description:``},actions:{required:!1,tsType:{name:`ReactNode`},description:`Right side of the header row, usually icon buttons.`}},composes:[`Omit`]}})))()}var v,y,b,x,S,C;function w(){return(w=e((()=>{m(),o(),_(),c(),u(),v=t(),y={title:`Primitives/FloatingPanel`,component:h,parameters:{layout:`padded`,docs:{description:{component:"The **only** place shadow is used. Inside it `text-white/64` does not work — use `text-on-white/64`."}}}},b=`text-on-white/64 hover:bg-black/6 hover:text-on-white`,x={args:{title:`Summary`,actions:(0,v.jsxs)(v.Fragment,{children:[(0,v.jsx)(l,{icon:(0,v.jsx)(p,{}),label:`Download`,variant:`ghost`,size:`sm`,className:b}),(0,v.jsx)(l,{icon:(0,v.jsx)(s,{}),label:`Close`,variant:`ghost`,size:`sm`,className:b})]}),children:(0,v.jsxs)(`div`,{className:`w-[320px] text-sm text-on-white/64`,children:[(0,v.jsx)(`p`,{className:`font-medium text-on-white`,children:`Documents`}),(0,v.jsx)(`p`,{className:`mt-2 leading-relaxed`,children:`Survey and shipping details that will be sent to backers once the campaign closes.`})]})}},S={render:()=>(0,v.jsx)(`div`,{className:`rounded-xl bg-surface-1 p-10`,children:(0,v.jsx)(h,{title:`Confirm your pledge`,className:`w-[380px]`,children:(0,v.jsxs)(`div`,{className:`flex flex-col gap-3 text-sm`,children:[(0,v.jsxs)(`div`,{className:`flex justify-between`,children:[(0,v.jsx)(`span`,{className:`text-on-white/64`,children:`Reward — Early Bird`}),(0,v.jsx)(`span`,{className:`font-medium tabular-nums`,children:`599.00`})]}),(0,v.jsxs)(`div`,{className:`flex justify-between`,children:[(0,v.jsx)(`span`,{className:`text-on-white/64`,children:`Shipping`}),(0,v.jsx)(`span`,{className:`font-medium tabular-nums`,children:`25.00`})]}),(0,v.jsx)(`div`,{className:`my-1 h-px bg-black/8`}),(0,v.jsxs)(`div`,{className:`flex justify-between text-base`,children:[(0,v.jsx)(`span`,{className:`font-medium`,children:`Total`}),(0,v.jsx)(`span`,{className:`font-semibold tabular-nums`,children:`624.00`})]}),(0,v.jsx)(d,{variant:`accent`,fullWidth:!0,className:`mt-3`,children:`Confirm pledge`}),(0,v.jsx)(`p`,{className:`mt-1 text-center text-xs text-on-white/40`,children:`You are only charged if the project reaches its goal.`})]})})})},C=[`Default`,`Checkout`],x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  args: {
    title: 'Summary',
    actions: <>
        <IconButton icon={<Download />} label="Download" variant="ghost" size="sm" className={headerAction} />
        <IconButton icon={<X />} label="Close" variant="ghost" size="sm" className={headerAction} />
      </>,
    children: <div className="w-[320px] text-sm text-on-white/64">
        <p className="font-medium text-on-white">Documents</p>
        <p className="mt-2 leading-relaxed">
          Survey and shipping details that will be sent to backers once the campaign closes.
        </p>
      </div>
  }
}`,...x.parameters?.docs?.source}}},S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  render: () => <div className="rounded-xl bg-surface-1 p-10">
      <FloatingPanel title="Confirm your pledge" className="w-[380px]">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-on-white/64">Reward — Early Bird</span>
            <span className="font-medium tabular-nums">599.00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-white/64">Shipping</span>
            <span className="font-medium tabular-nums">25.00</span>
          </div>
          <div className="my-1 h-px bg-black/8" />
          <div className="flex justify-between text-base">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">624.00</span>
          </div>
          <Pill variant="accent" fullWidth className="mt-3">
            Confirm pledge
          </Pill>
          <p className="mt-1 text-center text-xs text-on-white/40">
            You are only charged if the project reaches its goal.
          </p>
        </div>
      </FloatingPanel>
    </div>
}`,...S.parameters?.docs?.source},description:{story:`Checkout — the one screen where a white surface dominates (docs/ui-kit.md §8.5).`,...S.parameters?.docs?.description}}}})))()}w();export{S as Checkout,x as Default,C as __namedExportsOrder,y as default};