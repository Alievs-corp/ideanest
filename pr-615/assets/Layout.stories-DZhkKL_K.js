import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-BldbIXEs.js";import{n as r,t as i}from"./cn-Dm4OyE3Q.js";import{r as a,t as o}from"./Avatar-QjutmKbH.js";import{n as s,t as c}from"./createLucideIcon-CtiNtVsy.js";import{n as l,t as u}from"./bell-Bz0w5jIe.js";import{n as d,t as f}from"./search-B1KS-rZU.js";import{n as p,t as m}from"./IconButton-CU-Y3Xt6.js";import{n as h,t as g}from"./Pill-Cd4-Xj9U.js";var _,v;function y(){return(y=e((()=>{s(),_={name:`compass`,size:24,node:[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z`,key:`9ktpf1`}]]},_.node,v=c(_)})))()}var b,x;function S(){return(S=e((()=>{s(),b={name:`layout-grid`,size:24,node:[[`rect`,{width:`7`,height:`7`,x:`3`,y:`3`,rx:`1`,key:`1g98yp`}],[`rect`,{width:`7`,height:`7`,x:`14`,y:`3`,rx:`1`,key:`6d4xhi`}],[`rect`,{width:`7`,height:`7`,x:`14`,y:`14`,rx:`1`,key:`nxv5o0`}],[`rect`,{width:`7`,height:`7`,x:`3`,y:`14`,rx:`1`,key:`1bb6yr`}]]},b.node,x=c(b)})))()}var C,w;function T(){return(T=e((()=>{s(),C={name:`message-square`,size:24,node:[[`path`,{d:`M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z`,key:`18887p`}]]},C.node,w=c(C)})))()}var E,D;function O(){return(O=e((()=>{s(),E={name:`settings`,size:24,node:[[`path`,{d:`M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915`,key:`1i5ecw`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}]]},E.node,D=c(E)})))()}var k,A;function j(){return(j=e((()=>{s(),k={name:`user`,size:24,node:[[`path`,{d:`M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2`,key:`975kel`}],[`circle`,{cx:`12`,cy:`7`,r:`4`,key:`17ys0d`}]]},k.node,A=c(k)})))()}function M({header:e,footer:t,className:n,children:r,...a}){return(0,P.jsxs)(`nav`,{"aria-label":`Primary`,className:i(`flex w-[72px] shrink-0 flex-col items-center gap-3 py-6`,`bg-surface-1`,n),...a,children:[e&&(0,P.jsx)(`div`,{className:`mb-2`,children:e}),(0,P.jsx)(`ul`,{className:`flex flex-col items-center gap-2`,children:r}),t&&(0,P.jsx)(`div`,{className:`mt-auto pt-4`,children:t})]})}function N({icon:e,label:t,active:n=!1,badge:r=!1,className:a,type:o=`button`,...s}){return(0,P.jsxs)(`li`,{className:`relative`,children:[(0,P.jsx)(`button`,{type:o,"aria-label":t,title:t,"aria-current":n?`page`:void 0,className:i(`grid size-11 place-items-center rounded-full`,`transition-[background-color,color] duration-200 ease-in-out`,`[&_svg]:size-5`,n?`bg-surface-4 text-lime-ink`:`text-fg-40 hover:bg-surface-3 hover:text-fg`,a),...s,children:e}),r&&(0,P.jsx)(`span`,{"aria-hidden":`true`,className:`pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-lime-500 ring-2 ring-[var(--surface-1)]`})]})}var P;function ee(){return(ee=e((()=>{r(),P=t(),M.__docgenInfo={description:``,methods:[],displayName:`Rail`,props:{header:{required:!1,tsType:{name:`ReactNode`},description:`Rendered at the top, above the items.`},footer:{required:!1,tsType:{name:`ReactNode`},description:`Rendered at the bottom, pinned.`}},composes:[`ComponentPropsWithoutRef`]},N.__docgenInfo={description:``,methods:[],displayName:`RailItem`,props:{icon:{required:!0,tsType:{name:`ReactNode`},description:``},label:{required:!0,tsType:{name:`string`},description:`Accessible name — icon-only controls need one.`},active:{required:!1,tsType:{name:`boolean`},description:``,defaultValue:{value:`false`,computed:!1}},badge:{required:!1,tsType:{name:`boolean`},description:`Unread count shown as a dot.`,defaultValue:{value:`false`,computed:!1}},type:{defaultValue:{value:`'button'`,computed:!1},required:!1}},composes:[`Omit`]}})))()}function te(){return typeof window.matchMedia==`function`&&window.matchMedia(`(prefers-reduced-motion: reduce)`).matches}function ne(e){return e?Array.from(e.children,e=>e.getBoundingClientRect()):null}function F({logo:e,nav:t,navClassName:n,groundClassName:r,actions:a,threshold:o=24,forceScrolled:s,className:c,...l}){let[u,d]=(0,L.useState)(s??!1),f=(0,L.useRef)(null),p=(0,L.useRef)(u),m=(0,L.useRef)(null),h=(0,L.useRef)([]),g=(0,L.useCallback)(e=>{e!==p.current&&(m.current=te()?null:ne(f.current),p.current=e,d(e))},[]);return(0,L.useEffect)(()=>{if(s!==void 0){g(s);return}let e=()=>g(window.scrollY>o);return e(),window.addEventListener(`scroll`,e,{passive:!0}),()=>window.removeEventListener(`scroll`,e)},[o,s,g]),(0,L.useLayoutEffect)(()=>{for(let e of h.current)e.cancel();h.current=[];let e=m.current;m.current=null;let t=f.current;if(!e||!t||t.children.length!==e.length)return;let n=Array.from(t.children),r=n.map(e=>e.getBoundingClientRect());n.forEach((t,n)=>{let i=e[n],a=r[n];if(!i||!a||!(t instanceof HTMLElement)||typeof t.animate!=`function`)return;let o=i.left+i.width/2-(a.left+a.width/2),s=i.top+i.height/2-(a.top+a.height/2);(o!==0||s!==0)&&h.current.push(t.animate([{transform:`translate(${o}px, ${s}px)`},{transform:`none`}],{duration:z,easing:B}))})},[u]),(0,L.useEffect)(()=>()=>{for(let e of h.current)e.cancel();h.current=[]},[]),(0,R.jsxs)(`header`,{"data-scrolled":u?``:void 0,className:i(`sticky top-0 z-50 w-full bg-transparent`,c),...l,children:[r!==void 0&&(0,R.jsx)(`span`,{"aria-hidden":`true`,"data-top-bar-ground":``,className:i(`pointer-events-none absolute inset-0 -z-10 border-b border-fg/6 bg-surface-1`,`transition-opacity duration-300 ease-in-out motion-reduce:transition-none`,u?`opacity-100`:`opacity-0`,r)}),(0,R.jsxs)(`div`,{ref:f,className:i(`flex items-center justify-between gap-4`,u?`px-[18px] py-5 sm:px-[26px]`:`px-5 pt-7 pb-3 sm:px-7`),children:[e,t&&(0,R.jsxs)(`div`,{className:i(`relative isolate flex h-10 items-center justify-around gap-10 rounded-full border border-transparent px-8`,u?`mx-auto max-w-[445px] text-on-white`:`max-w-full text-fg`,n),children:[(0,R.jsx)(`span`,{"aria-hidden":`true`,"data-top-bar-surface":``,className:i(`pointer-events-none absolute -inset-px -z-10 rounded-full border border-fg/8 bg-white`,`transition-opacity duration-300 ease-in-out motion-reduce:transition-none`,u?`opacity-100`:`opacity-0`)}),t]}),a&&(0,R.jsx)(`div`,{className:`flex shrink-0 items-center gap-2`,children:a})]})]})}function I({className:e,...t}){return(0,R.jsx)(`a`,{className:i(`text-sm font-medium tracking-[-0.01em] whitespace-nowrap`,`opacity-80 transition-opacity duration-150 hover:opacity-100`,e),...t})}var L,R,z,B;function V(){return(V=e((()=>{L=n(),r(),R=t(),z=300,B=`cubic-bezier(0.4, 0, 0.2, 1)`,F.__docgenInfo={description:``,methods:[],displayName:`TopBar`,props:{logo:{required:!1,tsType:{name:`ReactNode`},description:`Left slot — usually a wordmark.`},nav:{required:!1,tsType:{name:`ReactNode`},description:`Centre slot — the pill that collapses.`},navClassName:{required:!1,tsType:{name:`string`},description:`On the pill itself, for a consumer whose navigation is not drawn at every width.

The pill is a surface and a pair of 32px gutters, and both are paid whether or not
anything inside it is displayed: a consumer that hid its own links with \`hidden md:flex\`
was left with an empty white oval on a phone, holding 66px of a 390px row open. Hiding
the pill is the consumer's decision to make — some navigation belongs on a phone — so it
is a class rather than a breakpoint this component picks.`},groundClassName:{required:!1,tsType:{name:`string`},description:`Where the bar has no pill to float, the classes that show its collapsed GROUND: the page's own
\`--surface-1\`, full width, with a \`--divider\`-weight rule under it.

On a phone the web app hides the pill (\`navClassName\`), and with it the only thing that took a
surface. What was left was a wordmark and three buttons over text scrolling underneath them,
the wordmark printed across a heading. Below the width the pill disappears at, the bar takes
the page ground once it collapses — the same ground, so it does not read as a second panel —
and the content goes under it rather than through it. The consumer names that width, as it
names the pill's, because only it knows where its pill stops being drawn: \`"md:hidden"\`.
Absent, the bar has no ground at any width, as before.`},actions:{required:!1,tsType:{name:`ReactNode`},description:`Right slot — actions.`},threshold:{required:!1,tsType:{name:`number`},description:`Scroll offset in pixels at which the collapsed state engages.`,defaultValue:{value:`24`,computed:!1}},forceScrolled:{required:!1,tsType:{name:`boolean`},description:`Force the collapsed state. Useful in Storybook and for pages that never
scroll but still want the compact treatment.`}},composes:[`ComponentPropsWithoutRef`]},I.__docgenInfo={description:`Navigation link that inherits the bar's current text colour.`,methods:[],displayName:`TopBarLink`}})))()}function H(e,t,n){let r=n.getTime()-t.getTime();return r<=0?0:Math.max(0,Math.min(1,(e.getTime()-t.getTime())/r))}function U({start:e,end:t,markers:n=[],now:r,label:a=`Campaign timeline`,className:o,...s}){let c=r?H(r,e,t):null;return(0,W.jsxs)(`div`,{role:`group`,"aria-label":a,className:i(`relative flex h-11 items-center rounded-full bg-lime-500 px-4`,o),"data-on-lime":``,...s,children:[c!==null&&(0,W.jsx)(`div`,{"aria-hidden":`true`,className:`absolute inset-y-0 left-0 rounded-l-full bg-on-lime/10`,style:{width:`${c*100}%`}}),n.map(n=>{let r=H(n.at,e,t)*100;return n.isNow?(0,W.jsx)(`div`,{"aria-label":n.label,className:`absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-on-lime`,style:{left:`${r}%`}},n.id):(0,W.jsx)(`div`,{title:n.label,className:`absolute -translate-x-1/2`,style:{left:`${r}%`},children:n.content??(0,W.jsx)(`span`,{className:`rounded-full bg-on-lime/10 px-2.5 py-1 text-xs font-medium text-on-lime`,children:n.label})},n.id)})]})}var W;function G(){return(G=e((()=>{r(),W=t(),U.__docgenInfo={description:``,methods:[],displayName:`Timeline`,props:{start:{required:!0,tsType:{name:`Date`},description:``},end:{required:!0,tsType:{name:`Date`},description:``},markers:{required:!1,tsType:{name:`Array`,elements:[{name:`TimelineMarker`}],raw:`TimelineMarker[]`},description:``,defaultValue:{value:`[]`,computed:!1}},now:{required:!1,tsType:{name:`Date`},description:"Current time. Defaults to `start` so server rendering stays deterministic."},label:{required:!1,tsType:{name:`string`},description:`Accessible description of what the track represents.`,defaultValue:{value:`'Campaign timeline'`,computed:!1}}},composes:[`Omit`]}})))()}var K,q,J,Y,X,Z,Q,$,re;function ie(){return(ie=e((()=>{l(),y(),S(),T(),d(),O(),j(),ee(),V(),G(),h(),a(),p(),K=t(),q={title:`Layout/Shell`,parameters:{layout:`fullscreen`}},J={render:()=>(0,K.jsxs)(`div`,{className:`flex h-[520px] bg-surface-1`,children:[(0,K.jsxs)(M,{header:(0,K.jsx)(`div`,{className:`grid size-9 place-items-center rounded-lg bg-lime-500 font-display text-sm font-bold text-on-lime`,children:`IN`}),footer:(0,K.jsx)(o,{name:`Amara Osei`,size:`sm`}),children:[(0,K.jsx)(N,{icon:(0,K.jsx)(v,{}),label:`Discover`,active:!0}),(0,K.jsx)(N,{icon:(0,K.jsx)(x,{}),label:`My projects`}),(0,K.jsx)(N,{icon:(0,K.jsx)(w,{}),label:`Messages`,badge:!0}),(0,K.jsx)(N,{icon:(0,K.jsx)(u,{}),label:`Notifications`}),(0,K.jsx)(N,{icon:(0,K.jsx)(D,{}),label:`Settings`})]}),(0,K.jsx)(`div`,{className:`flex-1 p-8`,children:(0,K.jsxs)(`p`,{className:`text-sm text-fg-64`,children:[`The active item is a lime `,(0,K.jsx)(`em`,{children:`icon`}),`, never a lime surface. Permanent chrome should not shout as loudly as a campaign about to close.`]})})]})},Y={render:()=>(0,K.jsxs)(`div`,{className:`min-h-[520px] bg-surface-1`,children:[(0,K.jsx)(F,{forceScrolled:!1,logo:(0,K.jsx)(`span`,{className:`font-display text-lg font-semibold`,children:`IdeyaNest`}),nav:(0,K.jsxs)(K.Fragment,{children:[(0,K.jsx)(I,{href:`#`,children:`Discover`}),(0,K.jsx)(I,{href:`#`,children:`Start a project`}),(0,K.jsx)(I,{href:`#`,children:`About`})]}),actions:(0,K.jsx)(g,{size:`sm`,children:`Sign in`})}),(0,K.jsx)(`div`,{className:`px-7 py-10`,children:(0,K.jsx)(`p`,{className:`max-w-md text-sm text-fg-64`,children:`At the top of the page: transparent, wide.`})})]})},X={render:()=>(0,K.jsxs)(`div`,{className:`min-h-[520px] bg-surface-1`,children:[(0,K.jsx)(F,{forceScrolled:!0,logo:(0,K.jsx)(`span`,{className:`font-display text-lg font-semibold`,children:`IdeyaNest`}),nav:(0,K.jsxs)(K.Fragment,{children:[(0,K.jsx)(I,{href:`#`,children:`Discover`}),(0,K.jsx)(I,{href:`#`,children:`Start a project`}),(0,K.jsx)(I,{href:`#`,children:`About`})]}),actions:(0,K.jsxs)(K.Fragment,{children:[(0,K.jsx)(m,{icon:(0,K.jsx)(f,{}),label:`Search`,size:`sm`}),(0,K.jsx)(m,{icon:(0,K.jsx)(A,{}),label:`Account`,size:`sm`})]})}),(0,K.jsx)(`div`,{className:`px-7 py-10`,children:(0,K.jsx)(`p`,{className:`max-w-md text-sm text-fg-64`,children:`After scrolling: the pill narrows, turns white, and padding tightens — all on the same 300ms curve.`})})]})},Z=new Date(`2026-08-01T00:00:00Z`),Q=new Date(`2026-09-30T00:00:00Z`),$={parameters:{layout:`padded`},render:()=>(0,K.jsxs)(`div`,{className:`w-[760px] p-6`,children:[(0,K.jsx)(U,{start:Z,end:Q,now:new Date(`2026-08-28T00:00:00Z`),label:`Campaign timeline: 1 August to 30 September`,markers:[{id:`launch`,at:Z,label:`Launched`},{id:`goal`,at:new Date(`2026-08-19T00:00:00Z`),label:`Goal reached`},{id:`now`,at:new Date(`2026-08-28T00:00:00Z`),label:`Today`,isNow:!0},{id:`end`,at:Q,label:`Closes`}]}),(0,K.jsx)(`p`,{className:`mt-6 text-sm text-fg-64`,children:`A lime surface is right here — a live campaign is time-bound, and the strip exists to say the clock is running.`})]})},re=[`NavigationRail`,`CollapsingTopBar`,`CollapsedTopBar`,`CampaignTimeline`],J.parameters={...J.parameters,docs:{...J.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex h-[520px] bg-surface-1">
      <Rail header={<div className="grid size-9 place-items-center rounded-lg bg-lime-500 font-display text-sm font-bold text-on-lime">
            IN
          </div>} footer={<Avatar name="Amara Osei" size="sm" />}>
        <RailItem icon={<Compass />} label="Discover" active />
        <RailItem icon={<LayoutGrid />} label="My projects" />
        <RailItem icon={<MessageSquare />} label="Messages" badge />
        <RailItem icon={<Bell />} label="Notifications" />
        <RailItem icon={<Settings />} label="Settings" />
      </Rail>
      <div className="flex-1 p-8">
        <p className="text-sm text-fg-64">
          The active item is a lime <em>icon</em>, never a lime surface. Permanent chrome should not
          shout as loudly as a campaign about to close.
        </p>
      </div>
    </div>
}`,...J.parameters?.docs?.source}}},Y.parameters={...Y.parameters,docs:{...Y.parameters?.docs,source:{originalSource:`{
  render: () => <div className="min-h-[520px] bg-surface-1">
      <TopBar forceScrolled={false} logo={<span className="font-display text-lg font-semibold">IdeyaNest</span>} nav={<>
            <TopBarLink href="#">Discover</TopBarLink>
            <TopBarLink href="#">Start a project</TopBarLink>
            <TopBarLink href="#">About</TopBarLink>
          </>} actions={<Pill size="sm">Sign in</Pill>} />
      <div className="px-7 py-10">
        <p className="max-w-md text-sm text-fg-64">At the top of the page: transparent, wide.</p>
      </div>
    </div>
}`,...Y.parameters?.docs?.source},description:{story:"Toggle `forceScrolled` in the controls to compare states without scrolling.",...Y.parameters?.docs?.description}}},X.parameters={...X.parameters,docs:{...X.parameters?.docs,source:{originalSource:`{
  render: () => <div className="min-h-[520px] bg-surface-1">
      <TopBar forceScrolled logo={<span className="font-display text-lg font-semibold">IdeyaNest</span>} nav={<>
            <TopBarLink href="#">Discover</TopBarLink>
            <TopBarLink href="#">Start a project</TopBarLink>
            <TopBarLink href="#">About</TopBarLink>
          </>} actions={<>
            <IconButton icon={<Search />} label="Search" size="sm" />
            <IconButton icon={<User />} label="Account" size="sm" />
          </>} />
      <div className="px-7 py-10">
        <p className="max-w-md text-sm text-fg-64">
          After scrolling: the pill narrows, turns white, and padding tightens — all on the same
          300ms curve.
        </p>
      </div>
    </div>
}`,...X.parameters?.docs?.source}}},$.parameters={...$.parameters,docs:{...$.parameters?.docs,source:{originalSource:`{
  parameters: {
    layout: 'padded'
  },
  render: () => <div className="w-[760px] p-6">
      <Timeline start={START} end={END} now={new Date('2026-08-28T00:00:00Z')} label="Campaign timeline: 1 August to 30 September" markers={[{
      id: 'launch',
      at: START,
      label: 'Launched'
    }, {
      id: 'goal',
      at: new Date('2026-08-19T00:00:00Z'),
      label: 'Goal reached'
    }, {
      id: 'now',
      at: new Date('2026-08-28T00:00:00Z'),
      label: 'Today',
      isNow: true
    }, {
      id: 'end',
      at: END,
      label: 'Closes'
    }]} />
      <p className="mt-6 text-sm text-fg-64">
        A lime surface is right here — a live campaign is time-bound, and the strip exists to say
        the clock is running.
      </p>
    </div>
}`,...$.parameters?.docs?.source}}}})))()}ie();export{$ as CampaignTimeline,X as CollapsedTopBar,Y as CollapsingTopBar,J as NavigationRail,re as __namedExportsOrder,q as default};