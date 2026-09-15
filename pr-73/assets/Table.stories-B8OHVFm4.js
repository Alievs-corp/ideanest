import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-C4KUzqtf.js";import{n as r,t as i}from"./cn-Dm4OyE3Q.js";import{n as a,t as o}from"./Tag-CFCuQDVc.js";import{n as s,t as c}from"./createLucideIcon-yXg_vDnW.js";var l,u;function d(){return(d=e((()=>{s(),l={name:`arrow-down`,size:24,node:[[`path`,{d:`M12 5v14`,key:`s699le`}],[`path`,{d:`m19 12-7 7-7-7`,key:`1idqje`}]]},l.node,u=c(l)})))()}var f,p;function m(){return(m=e((()=>{s(),f={name:`arrow-up`,size:24,node:[[`path`,{d:`m5 12 7-7 7 7`,key:`hav0vg`}],[`path`,{d:`M12 19V5`,key:`x0mq9r`}]]},f.node,p=c(f)})))()}var h,g;function _(){return(_=e((()=>{s(),h={name:`chevrons-up-down`,size:24,node:[[`path`,{d:`m7 15 5 5 5-5`,key:`1hf1tw`}],[`path`,{d:`m7 9 5-5 5 5`,key:`sgt6xg`}]]},h.node,g=c(h)})))()}function v({caption:e,scrollLabel:t,sort:n=null,onSortChange:r,className:a,containerClassName:o,children:s,...c}){return(0,T.jsx)(`div`,{role:`region`,"aria-label":t??e??`Data table`,tabIndex:0,className:i(`w-full overflow-x-auto rounded-lg border border-white/8 bg-surface-2`,o),children:(0,T.jsxs)(`table`,{className:i(`w-full border-collapse text-left text-sm`,a),...c,children:[e&&(0,T.jsx)(`caption`,{className:`px-4 pt-4 pb-3 text-left text-sm text-white/64`,children:e}),(0,T.jsx)(E.Provider,{value:{sort:n,onSortChange:r},children:s})]})})}function y({className:e,...t}){return(0,T.jsx)(`thead`,{className:i(`border-b border-white/8`,e),...t})}function b({className:e,...t}){return(0,T.jsx)(`tbody`,{className:e,...t})}function x({interactive:e=!0,className:t,...n}){return(0,T.jsx)(`tr`,{className:i(`border-b border-white/6 last:border-b-0`,e&&`transition-colors duration-150 ease-in-out hover:bg-surface-3`,t),...n})}function S({align:e=`left`,sortKey:t,className:n,children:r,...a}){let{sort:o,onSortChange:s}=(0,w.useContext)(E),c=t!==void 0&&s!==void 0,l=c&&o&&o.key===t?o.direction:null,d=c?l??`none`:void 0,f=l===`ascending`?p:l===`descending`?u:g;return(0,T.jsx)(`th`,{scope:`col`,"aria-sort":d,className:i(`px-4 py-3 text-xs font-medium text-white/64`,e===`right`?`text-right`:`text-left`,n),...a,children:c?(0,T.jsxs)(`button`,{type:`button`,onClick:()=>s({key:t,direction:l===`ascending`?`descending`:`ascending`}),className:i(`inline-flex items-center gap-1.5 rounded-sm text-white/64 transition-colors`,`duration-150 ease-in-out hover:text-white`,e===`right`&&`flex-row-reverse`),children:[r,(0,T.jsx)(f,{"aria-hidden":`true`,className:i(`size-3.5`,!l&&`opacity-40`)})]}):r})}function C({align:e=`left`,className:t,...n}){return(0,T.jsx)(`td`,{className:i(`px-4 py-3 text-white`,e===`right`?`text-right tabular-nums`:`text-left`,t),...n})}var w,T,E;function D(){return(D=e((()=>{w=n(),d(),m(),_(),r(),T=t(),E=(0,w.createContext)({sort:null}),v.__docgenInfo={description:``,methods:[],displayName:`Table`,props:{caption:{required:!1,tsType:{name:`string`},description:`Visible caption. It is also the table's accessible name, so write it as a
description of the data ("Recent pledges"), not as a UI label ("Table").`},scrollLabel:{required:!1,tsType:{name:`string`},description:`Accessible name for the scroll region. Defaults to the caption.`},sort:{required:!1,tsType:{name:`union`,raw:`TableSort | null`,elements:[{name:`TableSort`},{name:`null`}]},description:"Controlled sort state, or `null` when nothing is sorted.",defaultValue:{value:`null`,computed:!1}},onSortChange:{required:!1,tsType:{name:`signature`,type:`function`,raw:`(sort: TableSort) => void`,signature:{arguments:[{type:{name:`TableSort`},name:`sort`}],return:{name:`void`}}},description:``},containerClassName:{required:!1,tsType:{name:`string`},description:`Class for the scrolling wrapper rather than the table element.`},children:{required:!1,tsType:{name:`ReactNode`},description:``}},composes:[`Omit`]},y.__docgenInfo={description:``,methods:[],displayName:`TableHead`},b.__docgenInfo={description:``,methods:[],displayName:`TableBody`},x.__docgenInfo={description:``,methods:[],displayName:`TableRow`,props:{interactive:{required:!1,tsType:{name:`boolean`},description:"Highlights the row on hover. Off inside `TableHead`.",defaultValue:{value:`true`,computed:!1}}},composes:[`ComponentPropsWithoutRef`]},S.__docgenInfo={description:``,methods:[],displayName:`TableHeaderCell`,props:{align:{required:!1,tsType:{name:`union`,raw:`'left' | 'right'`,elements:[{name:`literal`,value:`'left'`},{name:`literal`,value:`'right'`}]},description:"`right` for numeric columns only — see the file comment.",defaultValue:{value:`'left'`,computed:!1}},sortKey:{required:!1,tsType:{name:`string`},description:"Makes the column sortable. Must match `TableSort.key`."}},composes:[`ComponentPropsWithoutRef`]},C.__docgenInfo={description:``,methods:[],displayName:`TableCell`,props:{align:{required:!1,tsType:{name:`union`,raw:`'left' | 'right'`,elements:[{name:`literal`,value:`'left'`},{name:`literal`,value:`'right'`}]},description:"`right` for numeric columns only — see the file comment.",defaultValue:{value:`'left'`,computed:!1}}},composes:[`ComponentPropsWithoutRef`]}})))()}var O,k,A,j,M,N,P,F;function I(){return(I=e((()=>{O=n(),D(),a(),k=t(),A={title:`Data/Table`,component:v,parameters:{layout:`padded`,docs:{description:{component:`No zebra striping: surface colour encodes state in this system, so spending it on alternating rows would make a genuinely highlighted row indistinguishable. Money arrives pre-formatted as a string.`}}}},j=[{id:`1`,backer:`Amara Osei`,tier:`Early bird`,amount:`£48.00`,status:`settled`},{id:`2`,backer:`Rowan Hale`,tier:`Standard`,amount:`£1,240.00`,status:`settled`},{id:`3`,backer:`Tomas Vidal`,tier:`Founder`,amount:`£12,480.00`,status:`failed`},{id:`4`,backer:`Nia Brand`,tier:`Standard`,amount:`£96.50`,status:`settled`}],M={args:{caption:`Recent pledges`},render:e=>(0,k.jsxs)(v,{...e,children:[(0,k.jsx)(y,{children:(0,k.jsxs)(x,{interactive:!1,children:[(0,k.jsx)(S,{children:`Backer`}),(0,k.jsx)(S,{children:`Tier`}),(0,k.jsx)(S,{align:`right`,children:`Amount`}),(0,k.jsx)(S,{children:`Status`})]})}),(0,k.jsx)(b,{children:j.map(e=>(0,k.jsxs)(x,{children:[(0,k.jsx)(C,{children:e.backer}),(0,k.jsx)(C,{children:e.tier}),(0,k.jsx)(C,{align:`right`,children:e.amount}),(0,k.jsx)(C,{children:(0,k.jsx)(o,{variant:e.status===`failed`?`danger`:`success`,children:e.status===`failed`?`Payment failed`:`Settled`})})]},e.id))})]})},N={args:{caption:`Recent pledges, sortable`},render:e=>{let[t,n]=(0,O.useState)({key:`amount`,direction:`descending`}),r=[...j].sort((e,n)=>{if(!t)return 0;let r=t.key===`amount`?`amount`:`backer`,i=e[r].localeCompare(n[r]);return t.direction===`ascending`?i:-i});return(0,k.jsxs)(v,{...e,sort:t,onSortChange:n,children:[(0,k.jsx)(y,{children:(0,k.jsxs)(x,{interactive:!1,children:[(0,k.jsx)(S,{sortKey:`backer`,children:`Backer`}),(0,k.jsx)(S,{children:`Tier`}),(0,k.jsx)(S,{align:`right`,sortKey:`amount`,children:`Amount`})]})}),(0,k.jsx)(b,{children:r.map(e=>(0,k.jsxs)(x,{children:[(0,k.jsx)(C,{children:e.backer}),(0,k.jsx)(C,{children:e.tier}),(0,k.jsx)(C,{align:`right`,children:e.amount})]},e.id))})]})}},P={args:{caption:`Payout ledger`,scrollLabel:`Payout ledger, scrollable`},render:e=>(0,k.jsx)(`div`,{className:`max-w-md`,children:(0,k.jsxs)(v,{...e,children:[(0,k.jsx)(y,{children:(0,k.jsxs)(x,{interactive:!1,children:[[`Reference`,`Backer`,`Method`,`Settled on`,`Fee`].map(e=>(0,k.jsx)(S,{className:`whitespace-nowrap`,children:e},e)),(0,k.jsx)(S,{align:`right`,children:`Amount`})]})}),(0,k.jsx)(b,{children:(0,k.jsxs)(x,{children:[(0,k.jsx)(C,{className:`whitespace-nowrap`,children:`PLG-4820`}),(0,k.jsx)(C,{className:`whitespace-nowrap`,children:`Amara Osei`}),(0,k.jsx)(C,{className:`whitespace-nowrap`,children:`Card`}),(0,k.jsx)(C,{className:`whitespace-nowrap`,children:`14 Aug 2026`}),(0,k.jsx)(C,{className:`whitespace-nowrap`,children:`£1.44`}),(0,k.jsx)(C,{align:`right`,children:`£48.00`})]})})]})})},F=[`Default`,`Sortable`,`Scrollable`],M.parameters={...M.parameters,docs:{...M.parameters?.docs,source:{originalSource:`{
  args: {
    caption: 'Recent pledges'
  },
  render: args => <Table {...args}>
      <TableHead>
        <TableRow interactive={false}>
          <TableHeaderCell>Backer</TableHeaderCell>
          <TableHeaderCell>Tier</TableHeaderCell>
          <TableHeaderCell align="right">Amount</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {PLEDGES.map(pledge => <TableRow key={pledge.id}>
            <TableCell>{pledge.backer}</TableCell>
            <TableCell>{pledge.tier}</TableCell>
            <TableCell align="right">{pledge.amount}</TableCell>
            <TableCell>
              <Tag variant={pledge.status === 'failed' ? 'danger' : 'success'}>
                {pledge.status === 'failed' ? 'Payment failed' : 'Settled'}
              </Tag>
            </TableCell>
          </TableRow>)}
      </TableBody>
    </Table>
}`,...M.parameters?.docs?.source}}},N.parameters={...N.parameters,docs:{...N.parameters?.docs,source:{originalSource:`{
  args: {
    caption: 'Recent pledges, sortable'
  },
  render: args => {
    const [sort, setSort] = useState<TableSort | null>({
      key: 'amount',
      direction: 'descending'
    });
    const ordered = [...PLEDGES].sort((a, b) => {
      if (!sort) return 0;
      const key = sort.key === 'amount' ? 'amount' : 'backer';
      const result = a[key].localeCompare(b[key]);
      return sort.direction === 'ascending' ? result : -result;
    });
    return <Table {...args} sort={sort} onSortChange={setSort}>
        <TableHead>
          <TableRow interactive={false}>
            <TableHeaderCell sortKey="backer">Backer</TableHeaderCell>
            <TableHeaderCell>Tier</TableHeaderCell>
            <TableHeaderCell align="right" sortKey="amount">
              Amount
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {ordered.map(pledge => <TableRow key={pledge.id}>
              <TableCell>{pledge.backer}</TableCell>
              <TableCell>{pledge.tier}</TableCell>
              <TableCell align="right">{pledge.amount}</TableCell>
            </TableRow>)}
        </TableBody>
      </Table>;
  }
}`,...N.parameters?.docs?.source},description:{story:`The caller owns the sort and re-orders its own data — the rows on screen are
usually one page of a server-side query, so the table must not shuffle them.`,...N.parameters?.docs?.description}}},P.parameters={...P.parameters,docs:{...P.parameters?.docs,source:{originalSource:`{
  args: {
    caption: 'Payout ledger',
    scrollLabel: 'Payout ledger, scrollable'
  },
  render: args => <div className="max-w-md">
      <Table {...args}>
        <TableHead>
          <TableRow interactive={false}>
            {['Reference', 'Backer', 'Method', 'Settled on', 'Fee'].map(heading => <TableHeaderCell key={heading} className="whitespace-nowrap">
                {heading}
              </TableHeaderCell>)}
            <TableHeaderCell align="right">Amount</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell className="whitespace-nowrap">PLG-4820</TableCell>
            <TableCell className="whitespace-nowrap">Amara Osei</TableCell>
            <TableCell className="whitespace-nowrap">Card</TableCell>
            <TableCell className="whitespace-nowrap">14 Aug 2026</TableCell>
            <TableCell className="whitespace-nowrap">£1.44</TableCell>
            <TableCell align="right">£48.00</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
}`,...P.parameters?.docs?.source},description:{story:"Wide tables scroll inside a named, focusable region. Without `tabIndex`, the\nright-hand columns are reachable by pointer only.",...P.parameters?.docs?.description}}}})))()}I();export{M as Default,P as Scrollable,N as Sortable,F as __namedExportsOrder,A as default};