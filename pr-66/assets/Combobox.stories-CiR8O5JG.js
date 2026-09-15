import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-BdYQlg6M.js";import{n as r,t as i}from"./cn-Dm4OyE3Q.js";import{n as a,t as o}from"./search-BiboxEkJ.js";import{n as s,r as c,t as l}from"./Field-q0ZonSrP.js";import{n as u,t as d}from"./inputSkin-0g8z56Iq.js";function f(e,t,n){return`${e} ${e===1?t:n}`}function p({value:e,onValueChange:t,options:n,open:r,onOpenChange:a,onSelect:o,onSubmit:s,listboxLabel:l,message:d,announcement:p,size:g,invalid:_,leading:v,className:y,inputClassName:b,onKeyDown:x,...S}){let C=`${(0,m.useId)()}-listbox`,w=c({id:S.id,"aria-describedby":S[`aria-describedby`],invalid:_,required:S.required}),[T,E]=(0,m.useState)(null),D=(0,m.useMemo)(()=>n.find(e=>e.id===T)??null,[n,T]),O=(0,m.useRef)(null),k=r&&(n.length>0||d!=null);(0,m.useEffect)(()=>{T!==null&&(O.current?.querySelector(`[data-active="true"]`))?.scrollIntoView({block:`nearest`})},[T]);let A=(0,m.useCallback)(e=>{if(n.length===0)return;let t=n.findIndex(e=>e.id===T),i=n.length-1,o;switch(e){case`first`:o=0;break;case`last`:o=i;break;case`next`:o=t===i?0:t+1;break;case`previous`:o=t<=0?i:t-1}E(n[o]?.id??null),r||a(!0)},[n,T,r,a]),j=(0,m.useCallback)(()=>{E(null),a(!1)},[a]),M=(0,m.useCallback)(e=>{E(null),a(!1),o(e)},[o,a]);function N(t){if(x?.(t),!t.defaultPrevented)switch(t.key){case`ArrowDown`:t.preventDefault(),A(`next`);return;case`ArrowUp`:t.preventDefault(),A(`previous`);return;case`Home`:if(!k||D===null)return;t.preventDefault(),A(`first`);return;case`End`:if(!k||D===null)return;t.preventDefault(),A(`last`);return;case`Enter`:if(t.preventDefault(),k&&D!==null){M(D);return}j(),s?.(e);return;case`Escape`:if(!k)return;t.preventDefault(),j();return;case`Tab`:k&&j();return;default:return}}let P=k?n.length===0?`No suggestions.`:`${f(n.length,`suggestion`,`suggestions`)} available.`:``;return(0,h.jsxs)(`div`,{className:i(`relative`,y),onBlur:e=>{e.currentTarget.contains(e.relatedTarget)||j()},children:[v&&(0,h.jsx)(`span`,{className:`pointer-events-none absolute inset-y-0 left-3 z-10 grid place-items-center text-white/40 [&_svg]:size-4`,children:v}),(0,h.jsx)(`input`,{...S,type:`text`,role:`combobox`,value:e,onChange:e=>{E(null),t(e.target.value)},onKeyDown:N,autoComplete:`off`,"aria-autocomplete":`list`,"aria-expanded":k,"aria-controls":C,"aria-activedescendant":D?.id,id:w.id,"aria-describedby":w[`aria-describedby`],"aria-invalid":w[`aria-invalid`],required:w.required,className:i(u({size:g,invalid:w.invalid}),v&&`pl-10`,b)}),k&&(0,h.jsxs)(`div`,{className:i(`absolute top-[calc(100%+4px)] right-0 left-0 z-20 overflow-hidden`,`rounded-md border border-white/8 bg-surface-3`),children:[d!=null&&(0,h.jsx)(`p`,{className:`px-3 py-2.5 text-[13px] text-white/64`,children:d}),(0,h.jsx)(`ul`,{ref:O,id:C,role:`listbox`,"aria-label":l,className:`max-h-[min(60vh,320px)] list-none overflow-y-auto`,children:n.map(e=>{let t=e.id===D?.id;return(0,h.jsxs)(`li`,{id:e.id,role:`option`,"aria-selected":t,"data-active":t?`true`:void 0,onMouseDown:e=>e.preventDefault(),onClick:()=>M(e),onPointerMove:()=>E(e.id),className:i(`flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm`,`transition-colors duration-150 ease-in-out`,t?`bg-surface-4 text-white`:`text-white/64`),children:[(0,h.jsx)(`span`,{className:`truncate`,children:e.label}),e.kind!==void 0&&(0,h.jsx)(`span`,{className:`shrink-0 text-xs text-white/40`,children:e.kind})]},e.id)})})]}),(0,h.jsx)(`p`,{"aria-live":`polite`,"aria-atomic":`true`,className:`sr-only`,children:p??P})]})}var m,h;function g(){return(g=e((()=>{m=n(),r(),s(),d(),h=t(),p.__docgenInfo={description:``,methods:[],displayName:`Combobox`,props:{value:{required:!0,tsType:{name:`string`},description:`What is in the box. The source of truth for what a plain Enter submits.`},onValueChange:{required:!0,tsType:{name:`signature`,type:`function`,raw:`(value: string) => void`,signature:{arguments:[{type:{name:`string`},name:`value`}],return:{name:`void`}}},description:``},options:{required:!0,tsType:{name:`unknown`},description:`The rows. Empty is a legitimate state and is announced, not hidden.`},open:{required:!0,tsType:{name:`boolean`},description:"Whether the popup is displayed. `aria-expanded` mirrors it exactly."},onOpenChange:{required:!0,tsType:{name:`signature`,type:`function`,raw:`(open: boolean) => void`,signature:{arguments:[{type:{name:`boolean`},name:`open`}],return:{name:`void`}}},description:``},onSelect:{required:!0,tsType:{name:`signature`,type:`function`,raw:`(option: ComboboxOption) => void`,signature:{arguments:[{type:{name:`ComboboxOption`},name:`option`}],return:{name:`void`}}},description:`A row was chosen — by Enter on the active option, or by pointer.`},onSubmit:{required:!1,tsType:{name:`signature`,type:`function`,raw:`(value: string) => void`,signature:{arguments:[{type:{name:`string`},name:`value`}],return:{name:`void`}}},description:`Enter with no active option: the typed text, as typed.`},listboxLabel:{required:!0,tsType:{name:`string`},description:`The listbox's accessible name. Required — it is a named region.`},message:{required:!1,tsType:{name:`ReactNode`},description:`Shown inside the popup above the rows: "Loading", a refusal, "no
suggestions". Its presence is enough to display the popup with no rows in
it, because "nothing found" is an answer and silence is a broken control.`},announcement:{required:!1,tsType:{name:`string`},description:`What the polite live region says. Defaults to the row count, or to "No
suggestions" when the popup is open and empty. Pass a string to describe a
state the count cannot — loading, or a refusal.`},size:{required:!1,tsType:{name:`union`,raw:`'sm' | 'md' | 'lg'`,elements:[{name:`literal`,value:`'sm'`},{name:`literal`,value:`'md'`},{name:`literal`,value:`'lg'`}]},description:``},invalid:{required:!1,tsType:{name:`boolean`},description:``},leading:{required:!1,tsType:{name:`ReactNode`},description:`Decoration, not a control — kept out of the pointer path.`},className:{required:!1,tsType:{name:`string`},description:"Wrapper class. The input's own class is `inputClassName`."},inputClassName:{required:!1,tsType:{name:`string`},description:``}},composes:[`Omit`]}})))()}var _,v,y,b,x,S,C,w,T,E,D,O;function k(){return(k=e((()=>{a(),_=n(),s(),g(),v=t(),y={title:`Overlays/Combobox`,component:p,parameters:{layout:`padded`,docs:{description:{component:"A text input with a listbox popup. DOM focus never leaves the input — the active row is named by `aria-activedescendant`. There is no inline completion: the typed value is what a plain Enter submits. Each row says its kind as text, because colour and icon never carry meaning alone (ui-kit §9.2)."}}},args:{value:``,onValueChange:()=>{},options:[],open:!1,onOpenChange:()=>{},onSelect:()=>{},listboxLabel:`Suggestions`},decorators:[e=>(0,v.jsx)(`div`,{className:`h-[320px] w-[420px]`,children:(0,v.jsx)(e,{})})]},b=[{id:`suggestion-campaign`,label:`Oyun gecəsi dəsti`,kind:`Campaign`},{id:`suggestion-category`,label:`Games`,kind:`Category`},{id:`suggestion-subcategory`,label:`Tabletop games`,kind:`Subcategory`},{id:`suggestion-tag`,label:`handmade`,kind:`Tag`}],x={args:{value:`oyun`,placeholder:`Search campaigns`,leading:(0,v.jsx)(o,{})}},S={args:{value:`oyun`,open:!0,options:b,placeholder:`Search campaigns`,leading:(0,v.jsx)(o,{})}},C={render:e=>{let[t,n]=(0,_.useState)(``),[r,i]=(0,_.useState)(!1),a=b.filter(e=>e.label.toLowerCase().includes(t.toLowerCase()));return(0,v.jsx)(p,{...e,value:t,onValueChange:e=>{n(e),i(e.length>=2)},open:r,onOpenChange:i,options:t.length>=2?a:[],message:t.length>=2&&a.length===0?`No suggestions.`:void 0,leading:(0,v.jsx)(o,{}),placeholder:`Search campaigns`})}},w={args:{value:`qwertyuiop`,open:!0,options:[],message:`No suggestions for “qwertyuiop”. Press Enter to search anyway.`,leading:(0,v.jsx)(o,{})}},T={args:{value:`oyu`,open:!0,options:[],message:`Looking for suggestions`,leading:(0,v.jsx)(o,{})}},E={args:{value:`oyun`,open:!0,options:[],message:`Suggestions are unavailable. Press Enter to search for what you typed.`,leading:(0,v.jsx)(o,{})}},D={render:e=>(0,v.jsx)(l,{label:`Search campaigns`,hint:`Titles, categories, and tags.`,children:(0,v.jsx)(p,{...e,value:`oyun`,open:!0,options:b,leading:(0,v.jsx)(o,{})})})},O=[`Closed`,`Open`,`Interactive`,`NoSuggestions`,`Loading`,`Failed`,`InAField`],x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  args: {
    value: 'oyun',
    placeholder: 'Search campaigns',
    leading: <Search />
  }
}`,...x.parameters?.docs?.source}}},S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  args: {
    value: 'oyun',
    open: true,
    options: SUGGESTIONS,
    placeholder: 'Search campaigns',
    leading: <Search />
  }
}`,...S.parameters?.docs?.source}}},C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [value, setValue] = useState('');
    const [open, setOpen] = useState(false);
    const matches = SUGGESTIONS.filter(option => option.label.toLowerCase().includes(value.toLowerCase()));
    return <Combobox {...args} value={value} onValueChange={next => {
      setValue(next);
      setOpen(next.length >= 2);
    }} open={open} onOpenChange={setOpen} options={value.length >= 2 ? matches : []} message={value.length >= 2 && matches.length === 0 ? 'No suggestions.' : undefined} leading={<Search />} placeholder="Search campaigns" />;
  }
}`,...C.parameters?.docs?.source},description:{story:`Type, then arrow. The active row highlights and \`aria-activedescendant\`
follows it, while the caret and the typed text stay where they were — which
is the behaviour to check by hand, because no snapshot can see a caret.`,...C.parameters?.docs?.description}}},w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  args: {
    value: 'qwertyuiop',
    open: true,
    options: [],
    message: 'No suggestions for “qwertyuiop”. Press Enter to search anyway.',
    leading: <Search />
  }
}`,...w.parameters?.docs?.source},description:{story:`Nothing matched. Silence would read as a control that had broken.`,...w.parameters?.docs?.description}}},T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  args: {
    value: 'oyu',
    open: true,
    options: [],
    message: 'Looking for suggestions',
    leading: <Search />
  }
}`,...T.parameters?.docs?.source}}},E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  args: {
    value: 'oyun',
    open: true,
    options: [],
    message: 'Suggestions are unavailable. Press Enter to search for what you typed.',
    leading: <Search />
  }
}`,...E.parameters?.docs?.source},description:{story:`A refusal is the service's own words. The input still submits — a suggestion
list that cannot be built is not a search box that has stopped working.`,...E.parameters?.docs?.description}}},D.parameters={...D.parameters,docs:{...D.parameters?.docs,source:{originalSource:`{
  render: args => <Field label="Search campaigns" hint="Titles, categories, and tags.">
      <Combobox {...args} value="oyun" open options={SUGGESTIONS} leading={<Search />} />
    </Field>
}`,...D.parameters?.docs?.source}}}})))()}k();export{x as Closed,E as Failed,D as InAField,C as Interactive,T as Loading,w as NoSuggestions,S as Open,O as __namedExportsOrder,y as default};