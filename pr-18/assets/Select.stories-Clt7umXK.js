import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-Ol3ms5Ie.js";import{n,t as r}from"./cn-Dm4OyE3Q.js";import{n as i,t as a}from"./createLucideIcon-BMzY5Fnu.js";import{a as o,t as s}from"./sample-data-6f0rXx-Z.js";import{n as c,r as l,t as u}from"./Field-B73v0ous.js";import{n as d,t as f}from"./inputSkin-0g8z56Iq.js";var p,m;function h(){return(h=e((()=>{i(),p={name:`chevron-down`,size:24,node:[[`path`,{d:`m6 9 6 6 6-6`,key:`qrunsl`}]]},p.node,m=a(p)})))()}function g({size:e,invalid:t,placeholder:n,className:i,children:a,...o}){let s=l({id:o.id,"aria-describedby":o[`aria-describedby`],invalid:t,required:o.required});return(0,_.jsxs)(`div`,{className:`relative`,children:[(0,_.jsxs)(`select`,{...o,id:s.id,"aria-describedby":s[`aria-describedby`],"aria-invalid":s[`aria-invalid`],required:s.required,defaultValue:n!==void 0&&o.value===void 0&&o.defaultValue===void 0?``:o.defaultValue,className:r(d({size:e,invalid:s.invalid}),`cursor-pointer appearance-none pr-10`,i),children:[n!==void 0&&(0,_.jsx)(`option`,{value:``,disabled:!0,children:n}),a]}),(0,_.jsx)(m,{"aria-hidden":`true`,className:`pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-white/40`})]})}var _;function v(){return(v=e((()=>{h(),n(),c(),f(),_=t(),g.__docgenInfo={description:``,methods:[],displayName:`Select`,props:{placeholder:{required:!1,tsType:{name:`string`},description:`Renders a disabled empty option first, so "nothing chosen yet" is a state
the user can see rather than a silent default.`}},composes:[`Omit`,`VariantProps`]}})))()}var y,b,x,S,C,w,T,E,D;function O(){return(O=e((()=>{c(),v(),o(),y=t(),b=s.map(e=>(0,y.jsx)(`option`,{value:e,children:e},e)),x={title:`Form/Select`,component:g,parameters:{layout:`padded`,docs:{description:{component:"A native `<select>` on purpose: type-ahead, Home/End, and the platform wheel picker on mobile all come for free, and no hand-rolled listbox gets every one of them right."}}},args:{placeholder:`Choose a category`,children:b},decorators:[e=>(0,y.jsx)(`div`,{className:`w-[360px]`,children:(0,y.jsx)(e,{})})]},S={},C={args:{size:`sm`}},w={args:{disabled:!0}},T={args:{invalid:!0}},E={render:e=>(0,y.jsx)(u,{label:`Category`,hint:`Decides which discovery rails the campaign appears in.`,required:!0,children:(0,y.jsx)(g,{...e})})},D=[`Default`,`Small`,`Disabled`,`Invalid`,`InAField`],S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{}`,...S.parameters?.docs?.source}}},C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  args: {
    size: 'sm'
  }
}`,...C.parameters?.docs?.source}}},w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  args: {
    disabled: true
  }
}`,...w.parameters?.docs?.source}}},T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  args: {
    invalid: true
  }
}`,...T.parameters?.docs?.source}}},E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  render: args => <Field label="Category" hint="Decides which discovery rails the campaign appears in." required>
      <Select {...args} />
    </Field>
}`,...E.parameters?.docs?.source}}}})))()}O();export{S as Default,w as Disabled,E as InAField,T as Invalid,C as Small,D as __namedExportsOrder,x as default};