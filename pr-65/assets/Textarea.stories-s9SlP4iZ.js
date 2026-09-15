import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-BdYQlg6M.js";import{n,t as r}from"./Field-q0ZonSrP.js";import{n as i,t as a}from"./Textarea-ohSBnK8e.js";var o,s,c,l,u,d,f;function p(){return(p=e((()=>{n(),i(),o=t(),s={title:`Form/Textarea`,component:a,parameters:{layout:`padded`,docs:{description:{component:"`autoGrow` writes the height directly. Height is never transitioned — it forces layout on every frame, and an easing field under a cursor is noise."}}},args:{placeholder:`What are you building, and why now?`},decorators:[e=>(0,o.jsx)(`div`,{className:`w-[420px]`,children:(0,o.jsx)(e,{})})]},c={},l={args:{autoGrow:!0,rows:2}},u={args:{invalid:!0}},d={render:()=>(0,o.jsx)(r,{label:`Short description`,hint:`The first thing a backer reads.`,error:`Say what the money is for.`,required:!0,children:(0,o.jsx)(a,{autoGrow:!0,rows:3})})},f=[`Default`,`AutoGrow`,`Invalid`,`InAField`],c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{}`,...c.parameters?.docs?.source}}},l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    autoGrow: true,
    rows: 2
  }
}`,...l.parameters?.docs?.source}}},u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    invalid: true
  }
}`,...u.parameters?.docs?.source}}},d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Field label="Short description" hint="The first thing a backer reads." error="Say what the money is for." required>
      <Textarea autoGrow rows={3} />
    </Field>
}`,...d.parameters?.docs?.source}}}})))()}p();export{l as AutoGrow,c as Default,d as InAField,u as Invalid,f as __namedExportsOrder,s as default};