import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-C4KUzqtf.js";import{n as r,t as i}from"./cn-Dm4OyE3Q.js";import{r as a,t as o}from"./Avatar-DybT5fwi.js";import{n as s,t as c}from"./createLucideIcon-yXg_vDnW.js";import{n as l,t as u}from"./bell-BUwIg9u7.js";import{n as d,t as f}from"./search-C3m30xY2.js";import{n as p,t as m}from"./IconButton-CLK1z2vs.js";import{n as ee,t as h}from"./Pill-B0hOB13w.js";var g,_;function v(){return(v=e((()=>{s(),g={name:`compass`,size:24,node:[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z`,key:`9ktpf1`}]]},g.node,_=c(g)})))()}var y,b;function x(){return(x=e((()=>{s(),y={name:`layout-grid`,size:24,node:[[`rect`,{width:`7`,height:`7`,x:`3`,y:`3`,rx:`1`,key:`1g98yp`}],[`rect`,{width:`7`,height:`7`,x:`14`,y:`3`,rx:`1`,key:`6d4xhi`}],[`rect`,{width:`7`,height:`7`,x:`14`,y:`14`,rx:`1`,key:`nxv5o0`}],[`rect`,{width:`7`,height:`7`,x:`3`,y:`14`,rx:`1`,key:`1bb6yr`}]]},y.node,b=c(y)})))()}var S,C;function w(){return(w=e((()=>{s(),S={name:`message-square`,size:24,node:[[`path`,{d:`M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z`,key:`18887p`}]]},S.node,C=c(S)})))()}var T,E;function D(){return(D=e((()=>{s(),T={name:`settings`,size:24,node:[[`path`,{d:`M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915`,key:`1i5ecw`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}]]},T.node,E=c(T)})))()}var O,k;function A(){return(A=e((()=>{s(),O={name:`user`,size:24,node:[[`path`,{d:`M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2`,key:`975kel`}],[`circle`,{cx:`12`,cy:`7`,r:`4`,key:`17ys0d`}]]},O.node,k=c(O)})))()}function j({header:e,footer:t,className:n,children:r,...a}){return(0,N.jsxs)(`nav`,{"aria-label":`Primary`,className:i(`flex w-[72px] shrink-0 flex-col items-center gap-3 py-6`,`bg-surface-1`,n),...a,children:[e&&(0,N.jsx)(`div`,{className:`mb-2`,children:e}),(0,N.jsx)(`ul`,{className:`flex flex-col items-center gap-2`,children:r}),t&&(0,N.jsx)(`div`,{className:`mt-auto pt-4`,children:t})]})}function M({icon:e,label:t,active:n=!1,badge:r=!1,className:a,type:o=`button`,...s}){return(0,N.jsxs)(`li`,{className:`relative`,children:[(0,N.jsx)(`button`,{type:o,"aria-label":t,title:t,"aria-current":n?`page`:void 0,className:i(`grid size-11 place-items-center rounded-full`,`transition-[background-color,color] duration-200 ease-in-out`,`[&_svg]:size-5`,n?`bg-surface-4 text-lime-500`:`text-white/40 hover:bg-surface-3 hover:text-white`,a),...s,children:e}),r&&(0,N.jsx)(`span`,{"aria-hidden":`true`,className:`pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-lime-500 ring-2 ring-[var(--surface-1)]`})]})}var N;function P(){return(P=e((()=>{r(),N=t(),j.__docgenInfo={description:``,methods:[],displayName:`Rail`,props:{header:{required:!1,tsType:{name:`ReactNode`},description:`Rendered at the top, above the items.`},footer:{required:!1,tsType:{name:`ReactNode`},description:`Rendered at the bottom, pinned.`}},composes:[`ComponentPropsWithoutRef`]},M.__docgenInfo={description:``,methods:[],displayName:`RailItem`,props:{icon:{required:!0,tsType:{name:`ReactNode`},description:``},label:{required:!0,tsType:{name:`string`},description:`Accessible name — icon-only controls need one.`},active:{required:!1,tsType:{name:`boolean`},description:``,defaultValue:{value:`false`,computed:!1}},badge:{required:!1,tsType:{name:`boolean`},description:`Unread count shown as a dot.`,defaultValue:{value:`false`,computed:!1}},type:{defaultValue:{value:`'button'`,computed:!1},required:!1}},composes:[`Omit`]}})))()}function F({logo:e,nav:t,navClassName:n,actions:r,threshold:a=24,forceScrolled:o,className:s,...c}){let[l,u]=(0,L.useState)(o??!1);return(0,L.useEffect)(()=>{if(o!==void 0){u(o);return}let e=()=>u(window.scrollY>a);return e(),window.addEventListener(`scroll`,e,{passive:!0}),()=>window.removeEventListener(`scroll`,e)},[a,o]),(0,R.jsx)(`header`,{"data-scrolled":l?``:void 0,className:i(`sticky top-0 z-50 w-full bg-transparent`,s),...c,children:(0,R.jsxs)(`div`,{className:i(`flex items-center justify-between gap-4`,`transition-[padding] duration-300 ease-in-out`,l?`px-[26px] py-5`:`px-7 pt-7 pb-3`),children:[e,t&&(0,R.jsx)(`div`,{className:i(`flex h-10 items-center justify-around gap-10 rounded-full px-8`,`transition-[max-width,background-color,border-color] duration-300 ease-in-out`,l?`mx-auto max-w-[445px] border border-white/8 bg-white text-on-white`:`max-w-full border border-transparent bg-transparent text-white`,n),children:t}),r&&(0,R.jsx)(`div`,{className:`flex shrink-0 items-center gap-2`,children:r})]})})}function I({className:e,...t}){return(0,R.jsx)(`a`,{className:i(`text-sm font-medium tracking-[-0.01em] whitespace-nowrap`,`opacity-80 transition-opacity duration-150 hover:opacity-100`,e),...t})}var L,R;function z(){return(z=e((()=>{L=n(),r(),R=t(),F.__docgenInfo={description:``,methods:[],displayName:`TopBar`,props:{logo:{required:!1,tsType:{name:`ReactNode`},description:`Left slot — usually a wordmark.`},nav:{required:!1,tsType:{name:`ReactNode`},description:`Centre slot — the pill that collapses.`},navClassName:{required:!1,tsType:{name:`string`},description:`On the pill itself, for a consumer whose navigation is not drawn at every width.

The pill is a surface and a pair of 32px gutters, and both are paid whether or not
anything inside it is displayed: a consumer that hid its own links with \`hidden md:flex\`
was left with an empty white oval on a phone, holding 66px of a 390px row open. Hiding
the pill is the consumer's decision to make — some navigation belongs on a phone — so it
is a class rather than a breakpoint this component picks.`},actions:{required:!1,tsType:{name:`ReactNode`},description:`Right slot — actions.`},threshold:{required:!1,tsType:{name:`number`},description:`Scroll offset in pixels at which the collapsed state engages.`,defaultValue:{value:`24`,computed:!1}},forceScrolled:{required:!1,tsType:{name:`boolean`},description:`Force the collapsed state. Useful in Storybook and for pages that never
scroll but still want the compact treatment.`}},composes:[`ComponentPropsWithoutRef`]},I.__docgenInfo={description:`Navigation link that inherits the bar's current text colour.`,methods:[],displayName:`TopBarLink`}})))()}function B(e,t,n){let r=n.getTime()-t.getTime();return r<=0?0:Math.max(0,Math.min(1,(e.getTime()-t.getTime())/r))}function V({start:e,end:t,markers:n=[],now:r,label:a=`Campaign timeline`,className:o,...s}){let c=r?B(r,e,t):null;return(0,H.jsxs)(`div`,{role:`group`,"aria-label":a,className:i(`relative flex h-11 items-center rounded-full bg-lime-500 px-4`,o),"data-on-lime":``,...s,children:[c!==null&&(0,H.jsx)(`div`,{"aria-hidden":`true`,className:`absolute inset-y-0 left-0 rounded-l-full bg-on-lime/10`,style:{width:`${c*100}%`}}),n.map(n=>{let r=B(n.at,e,t)*100;return n.isNow?(0,H.jsx)(`div`,{"aria-label":n.label,className:`absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-on-lime`,style:{left:`${r}%`}},n.id):(0,H.jsx)(`div`,{title:n.label,className:`absolute -translate-x-1/2`,style:{left:`${r}%`},children:n.content??(0,H.jsx)(`span`,{className:`rounded-full bg-on-lime/10 px-2.5 py-1 text-xs font-medium text-on-lime`,children:n.label})},n.id)})]})}var H;function U(){return(U=e((()=>{r(),H=t(),V.__docgenInfo={description:``,methods:[],displayName:`Timeline`,props:{start:{required:!0,tsType:{name:`Date`},description:``},end:{required:!0,tsType:{name:`Date`},description:``},markers:{required:!1,tsType:{name:`Array`,elements:[{name:`TimelineMarker`}],raw:`TimelineMarker[]`},description:``,defaultValue:{value:`[]`,computed:!1}},now:{required:!1,tsType:{name:`Date`},description:"Current time. Defaults to `start` so server rendering stays deterministic."},label:{required:!1,tsType:{name:`string`},description:`Accessible description of what the track represents.`,defaultValue:{value:`'Campaign timeline'`,computed:!1}}},composes:[`Omit`]}})))()}var W,G,K,q,J,Y,X,Z,Q;function $(){return($=e((()=>{l(),v(),x(),w(),d(),D(),A(),P(),z(),U(),ee(),a(),p(),W=t(),G={title:`Layout/Shell`,parameters:{layout:`fullscreen`}},K={render:()=>(0,W.jsxs)(`div`,{className:`flex h-[520px] bg-surface-1`,children:[(0,W.jsxs)(j,{header:(0,W.jsx)(`div`,{className:`grid size-9 place-items-center rounded-lg bg-lime-500 font-display text-sm font-bold text-on-lime`,children:`IN`}),footer:(0,W.jsx)(o,{name:`Amara Osei`,size:`sm`}),children:[(0,W.jsx)(M,{icon:(0,W.jsx)(_,{}),label:`Discover`,active:!0}),(0,W.jsx)(M,{icon:(0,W.jsx)(b,{}),label:`My projects`}),(0,W.jsx)(M,{icon:(0,W.jsx)(C,{}),label:`Messages`,badge:!0}),(0,W.jsx)(M,{icon:(0,W.jsx)(u,{}),label:`Notifications`}),(0,W.jsx)(M,{icon:(0,W.jsx)(E,{}),label:`Settings`})]}),(0,W.jsx)(`div`,{className:`flex-1 p-8`,children:(0,W.jsxs)(`p`,{className:`text-sm text-white/64`,children:[`The active item is a lime `,(0,W.jsx)(`em`,{children:`icon`}),`, never a lime surface. Permanent chrome should not shout as loudly as a campaign about to close.`]})})]})},q={render:()=>(0,W.jsxs)(`div`,{className:`min-h-[520px] bg-surface-1`,children:[(0,W.jsx)(F,{forceScrolled:!1,logo:(0,W.jsx)(`span`,{className:`font-display text-lg font-semibold`,children:`IdeaNest`}),nav:(0,W.jsxs)(W.Fragment,{children:[(0,W.jsx)(I,{href:`#`,children:`Discover`}),(0,W.jsx)(I,{href:`#`,children:`Start a project`}),(0,W.jsx)(I,{href:`#`,children:`About`})]}),actions:(0,W.jsx)(h,{size:`sm`,children:`Sign in`})}),(0,W.jsx)(`div`,{className:`px-7 py-10`,children:(0,W.jsx)(`p`,{className:`max-w-md text-sm text-white/64`,children:`At the top of the page: transparent, wide.`})})]})},J={render:()=>(0,W.jsxs)(`div`,{className:`min-h-[520px] bg-surface-1`,children:[(0,W.jsx)(F,{forceScrolled:!0,logo:(0,W.jsx)(`span`,{className:`font-display text-lg font-semibold`,children:`IdeaNest`}),nav:(0,W.jsxs)(W.Fragment,{children:[(0,W.jsx)(I,{href:`#`,children:`Discover`}),(0,W.jsx)(I,{href:`#`,children:`Start a project`}),(0,W.jsx)(I,{href:`#`,children:`About`})]}),actions:(0,W.jsxs)(W.Fragment,{children:[(0,W.jsx)(m,{icon:(0,W.jsx)(f,{}),label:`Search`,size:`sm`}),(0,W.jsx)(m,{icon:(0,W.jsx)(k,{}),label:`Account`,size:`sm`})]})}),(0,W.jsx)(`div`,{className:`px-7 py-10`,children:(0,W.jsx)(`p`,{className:`max-w-md text-sm text-white/64`,children:`After scrolling: the pill narrows, turns white, and padding tightens — all on the same 300ms curve.`})})]})},Y=new Date(`2026-08-01T00:00:00Z`),X=new Date(`2026-09-30T00:00:00Z`),Z={parameters:{layout:`padded`},render:()=>(0,W.jsxs)(`div`,{className:`w-[760px] p-6`,children:[(0,W.jsx)(V,{start:Y,end:X,now:new Date(`2026-08-28T00:00:00Z`),label:`Campaign timeline: 1 August to 30 September`,markers:[{id:`launch`,at:Y,label:`Launched`},{id:`goal`,at:new Date(`2026-08-19T00:00:00Z`),label:`Goal reached`},{id:`now`,at:new Date(`2026-08-28T00:00:00Z`),label:`Today`,isNow:!0},{id:`end`,at:X,label:`Closes`}]}),(0,W.jsx)(`p`,{className:`mt-6 text-sm text-white/64`,children:`A lime surface is right here — a live campaign is time-bound, and the strip exists to say the clock is running.`})]})},Q=[`NavigationRail`,`CollapsingTopBar`,`CollapsedTopBar`,`CampaignTimeline`],K.parameters={...K.parameters,docs:{...K.parameters?.docs,source:{originalSource:`{
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
        <p className="text-sm text-white/64">
          The active item is a lime <em>icon</em>, never a lime surface. Permanent chrome should not
          shout as loudly as a campaign about to close.
        </p>
      </div>
    </div>
}`,...K.parameters?.docs?.source}}},q.parameters={...q.parameters,docs:{...q.parameters?.docs,source:{originalSource:`{
  render: () => <div className="min-h-[520px] bg-surface-1">
      <TopBar forceScrolled={false} logo={<span className="font-display text-lg font-semibold">IdeaNest</span>} nav={<>
            <TopBarLink href="#">Discover</TopBarLink>
            <TopBarLink href="#">Start a project</TopBarLink>
            <TopBarLink href="#">About</TopBarLink>
          </>} actions={<Pill size="sm">Sign in</Pill>} />
      <div className="px-7 py-10">
        <p className="max-w-md text-sm text-white/64">At the top of the page: transparent, wide.</p>
      </div>
    </div>
}`,...q.parameters?.docs?.source},description:{story:"Toggle `forceScrolled` in the controls to compare states without scrolling.",...q.parameters?.docs?.description}}},J.parameters={...J.parameters,docs:{...J.parameters?.docs,source:{originalSource:`{
  render: () => <div className="min-h-[520px] bg-surface-1">
      <TopBar forceScrolled logo={<span className="font-display text-lg font-semibold">IdeaNest</span>} nav={<>
            <TopBarLink href="#">Discover</TopBarLink>
            <TopBarLink href="#">Start a project</TopBarLink>
            <TopBarLink href="#">About</TopBarLink>
          </>} actions={<>
            <IconButton icon={<Search />} label="Search" size="sm" />
            <IconButton icon={<User />} label="Account" size="sm" />
          </>} />
      <div className="px-7 py-10">
        <p className="max-w-md text-sm text-white/64">
          After scrolling: the pill narrows, turns white, and padding tightens — all on the same
          300ms curve.
        </p>
      </div>
    </div>
}`,...J.parameters?.docs?.source}}},Z.parameters={...Z.parameters,docs:{...Z.parameters?.docs,source:{originalSource:`{
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
      <p className="mt-6 text-sm text-white/64">
        A lime surface is right here — a live campaign is time-bound, and the strip exists to say
        the clock is running.
      </p>
    </div>
}`,...Z.parameters?.docs?.source}}}})))()}$();export{Z as CampaignTimeline,J as CollapsedTopBar,q as CollapsingTopBar,K as NavigationRail,Q as __namedExportsOrder,G as default};