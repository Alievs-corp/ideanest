import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-CDLF_-s5.js";import{t as r}from"./react-dom-Ck7zlSTW.js";import{n as i,t as a}from"./cn-Dm4OyE3Q.js";import{n as o,t as s}from"./dist-CAbKXD0Y.js";import{n as c,t as l}from"./x-B8nvYZ3y.js";import{n as u,t as d}from"./IconButton-Bz4KfgCG.js";import{n as f,t as p}from"./Pill-DHu08TvC.js";import{n as m,t as h}from"./react-daC-q4_j.js";import{i as g,r as _,t as v}from"./useDismiss-BZEyZRFO.js";import{n as y,t as b}from"./overlayMotion-blO7VjGE.js";import{n as x,t as S}from"./Backdrop-DyMfCx4z.js";import{n as C,t as w}from"./useFocusTrap-DyC-Eq4g.js";function T({open:e,onOpenChange:t,title:n,description:r,footer:i,size:o,closeOnBackdropClick:s=!0,closeOnEscape:c=!0,showClose:u=!0,className:f,children:p,...h}){let v=(0,E.useRef)(null),b=(0,E.useId)(),x=(0,E.useId)(),w=(0,E.useCallback)(()=>t(!1),[t]);_({open:e,onDismiss:w,closeOnEscape:c}),g(e),C(e,v);let T=y({opacity:0,y:24});return!e||typeof document>`u`?null:(0,D.createPortal)((0,O.jsxs)(`div`,{className:`fixed inset-0 z-50 flex items-center justify-center p-4`,children:[(0,O.jsx)(S,{dismissible:s,onDismiss:w}),(0,O.jsxs)(m.div,{ref:v,role:`dialog`,"aria-modal":`true`,"aria-labelledby":b,"aria-describedby":r?x:void 0,tabIndex:-1,className:a(k({size:o}),f),...T,...h,children:[(0,O.jsxs)(`div`,{className:`flex items-start justify-between gap-4 px-6 pt-6 pb-4`,children:[(0,O.jsxs)(`div`,{children:[(0,O.jsx)(`h2`,{id:b,className:`text-lg font-medium tracking-[-0.02em]`,children:n}),r&&(0,O.jsx)(`p`,{id:x,className:`mt-1 text-sm text-on-white/64`,children:r})]}),u&&(0,O.jsx)(d,{icon:(0,O.jsx)(l,{}),label:`Close`,variant:`ghost`,size:`sm`,className:`-mr-1 shrink-0 text-on-white/64 hover:bg-black/6 hover:text-on-white`,onClick:w})]}),(0,O.jsx)(`div`,{className:`px-6 pb-6 text-sm text-on-white/64`,children:p}),i&&(0,O.jsx)(`div`,{className:`flex items-center justify-end gap-2 border-t border-black/8 px-6 py-4`,children:i})]})]}),document.body)}var E,D,O,k;function A(){return(A=e((()=>{o(),c(),h(),E=n(),D=r(),i(),u(),x(),b(),v(),w(),O=t(),k=s([`relative w-full overflow-hidden rounded-xl`,`bg-white text-on-white shadow-float`,`max-h-[calc(100vh-2rem)] overflow-y-auto`],{variants:{size:{sm:`max-w-[380px]`,md:`max-w-[520px]`,lg:`max-w-[720px]`}},defaultVariants:{size:`md`}})})))()}var j,M,N,P,F,I;function L(){return(L=e((()=>{j=n(),A(),f(),M=t(),N={title:`Overlays/Modal`,component:T,parameters:{layout:`centered`,docs:{description:{component:"The only overlay that is **white**. Focus moves in on open and returns to the trigger on close; `Escape` closes the topmost overlay only."}}},args:{open:!1,onOpenChange:()=>{},title:`Confirm your pledge`}},P={render:e=>{let[t,n]=(0,j.useState)(!1);return(0,M.jsxs)(M.Fragment,{children:[(0,M.jsx)(p,{onClick:()=>n(!0),children:`Open modal`}),(0,M.jsx)(T,{...e,open:t,onOpenChange:n,description:`You are only charged if the project reaches its goal.`,footer:(0,M.jsxs)(M.Fragment,{children:[(0,M.jsx)(p,{variant:`ghost`,onClick:()=>n(!1),children:`Cancel`}),(0,M.jsx)(p,{variant:`accent`,onClick:()=>n(!1),children:`Confirm pledge`})]}),children:(0,M.jsxs)(`div`,{className:`flex flex-col gap-3`,children:[(0,M.jsxs)(`div`,{className:`flex justify-between`,children:[(0,M.jsx)(`span`,{children:`Reward — Early Bird`}),(0,M.jsx)(`span`,{className:`font-medium text-on-white tabular-nums`,children:`599.00`})]}),(0,M.jsxs)(`div`,{className:`flex justify-between`,children:[(0,M.jsx)(`span`,{children:`Shipping`}),(0,M.jsx)(`span`,{className:`font-medium text-on-white tabular-nums`,children:`25.00`})]})]})})]})}},F={render:e=>{let[t,n]=(0,j.useState)(!1);return(0,M.jsxs)(M.Fragment,{children:[(0,M.jsx)(p,{variant:`danger`,onClick:()=>n(!0),children:`Cancel campaign`}),(0,M.jsx)(T,{...e,open:t,onOpenChange:n,size:`sm`,title:`Cancel this campaign?`,description:`Backers are refunded in full. This cannot be undone.`,closeOnBackdropClick:!1,closeOnEscape:!1,showClose:!1,footer:(0,M.jsxs)(M.Fragment,{children:[(0,M.jsx)(p,{variant:`ghost`,onClick:()=>n(!1),children:`Keep it running`}),(0,M.jsx)(p,{variant:`danger`,onClick:()=>n(!1),children:`Cancel campaign`})]})})]})}},I=[`Default`,`MustDecide`],P.parameters={...P.parameters,docs:{...P.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [open, setOpen] = useState(false);
    return <>
        <Pill onClick={() => setOpen(true)}>Open modal</Pill>
        <Modal {...args} open={open} onOpenChange={setOpen} description="You are only charged if the project reaches its goal." footer={<>
              <Pill variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Pill>
              <Pill variant="accent" onClick={() => setOpen(false)}>
                Confirm pledge
              </Pill>
            </>}>
          <div className="flex flex-col gap-3">
            <div className="flex justify-between">
              <span>Reward — Early Bird</span>
              <span className="font-medium text-on-white tabular-nums">599.00</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span className="font-medium text-on-white tabular-nums">25.00</span>
            </div>
          </div>
        </Modal>
      </>;
  }
}`,...P.parameters?.docs?.source}}},F.parameters={...F.parameters,docs:{...F.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [open, setOpen] = useState(false);
    return <>
        <Pill variant="danger" onClick={() => setOpen(true)}>
          Cancel campaign
        </Pill>
        <Modal {...args} open={open} onOpenChange={setOpen} size="sm" title="Cancel this campaign?" description="Backers are refunded in full. This cannot be undone." closeOnBackdropClick={false} closeOnEscape={false} showClose={false} footer={<>
              <Pill variant="ghost" onClick={() => setOpen(false)}>
                Keep it running
              </Pill>
              <Pill variant="danger" onClick={() => setOpen(false)}>
                Cancel campaign
              </Pill>
            </>} />
      </>;
  }
}`,...F.parameters?.docs?.source},description:{story:`A decision the user cannot dodge: no backdrop dismissal, no corner close.`,...F.parameters?.docs?.description}}}})))()}L();export{P as Default,F as MustDecide,I as __namedExportsOrder,N as default};