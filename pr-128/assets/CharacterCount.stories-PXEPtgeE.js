import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,p as n}from"./iframe-CDLF_-s5.js";import{n as r,t as i}from"./cn-Dm4OyE3Q.js";import{n as a,t as o}from"./Field-Ca3Y6NYf.js";import{n as s,t as c}from"./Textarea-DkdYRtoK.js";function l({count:e,limit:t,copy:n=p,locale:r=`en`,announceWithin:a=20,announceDelayMs:o=1e3,className:s,...c}){let l=t-e,m=l<0,h=m?-l:l,g=u(m?n.tooMany:n.remaining,h,r),[_,v]=(0,d.useState)(``);return(0,d.useEffect)(()=>{if(l>a){v(``);return}let e=setTimeout(()=>v(g),o);return()=>clearTimeout(e)},[g,l,a,o]),(0,f.jsxs)(`p`,{...c,className:i(`text-[13px] tabular-nums transition-colors duration-150 ease-in-out`,m?`text-danger`:`text-white/40`,s),children:[(0,f.jsx)(`span`,{"aria-hidden":`true`,children:g}),(0,f.jsx)(`span`,{role:`status`,"aria-live":`polite`,className:`sr-only`,children:_})]})}function u(e,t,n){let r=`other`;try{r=new Intl.PluralRules(n).select(t)}catch{}return(e[r]??e.other).replace(`{count}`,String(t))}var d,f,p;function m(){return(m=e((()=>{d=n(),r(),f=t(),p={remaining:{one:`{count} character remaining`,few:`{count} characters remaining`,many:`{count} characters remaining`,other:`{count} characters remaining`},tooMany:{one:`{count} character too many`,few:`{count} characters too many`,many:`{count} characters too many`,other:`{count} characters too many`}},l.__docgenInfo={description:`How much of a length limit is left. See docs/ui-kit.md §7.13.

COLOUR IS NOT THE MESSAGE. Passing the limit changes the wording — "3
characters too many" — and only then the colour (§9.2). A counter that merely
turns red has told a colour-blind creator nothing, and a screen reader
nothing at all.

THE VISIBLE COUNT IS \`aria-hidden\`, AND THE ANNOUNCEMENT IS SEPARATE. Two
different things are needed from one number: a sighted creator wants it
present at all times, and a screen-reader user wants to hear it only when it
starts to matter. Announcing every keystroke would talk over the typing echo
— the field becomes unusable long before the limit is reached — so the live
region stays empty until the remainder is inside \`announceWithin\`, and then
settles for \`announceDelayMs\` before it says anything. It is the pattern the
GOV.UK character count arrived at after user testing, for the same reason.

\`role="status"\` is polite by definition: it waits for a pause rather than
interrupting. An \`alert\` here would interrupt, which is precisely the
behaviour being avoided.

Counting is the caller's job, through \`count\`. Characters are not code units:
\`'🙂'.length\` is 2, and a counter that says 61 while the database is happy
with 60 is a counter that lies. The web application counts code points, which
is how Postgres counts \`varchar(60)\`.

<h2>The sentence is the caller's too, and it has to be</h2>

This used to build "3 characters too many" from an English plural rule in
code — \`value === 1 ? 'character' : 'characters'\`. That rule is English's
and no other language's: Russian selects between three forms by the last
digit, Azerbaijani and Turkish take no plural agreement after a numeral at
all, and a counter that is a sentence rather than a fraction (§7.13) cannot
be assembled from a number and a noun handed over separately.

So the caller supplies the forms, keyed by the categories \`Intl.PluralRules\`
reports, and this picks between them for \`locale\`. \`Intl.PluralRules\` is in
every browser this platform supports and costs nothing in the bundle — it is
the platform internationalisation API §21.1 already asks for elsewhere.

The library carries no catalogue, so the English forms stay as defaults: the
component works standing alone in Storybook, and an application that has a
catalogue passes its own.`,methods:[],displayName:`CharacterCount`,props:{count:{required:!0,tsType:{name:`number`},description:`Characters used, already counted the way the storage counts them.`},limit:{required:!0,tsType:{name:`number`},description:``},copy:{required:!1,tsType:{name:`CharacterCountCopy`},description:`The two sentences, in the reader's language.`,defaultValue:{value:`{
  remaining: {
    one: '{count} character remaining',
    few: '{count} characters remaining',
    many: '{count} characters remaining',
    other: '{count} characters remaining',
  },
  tooMany: {
    one: '{count} character too many',
    few: '{count} characters too many',
    many: '{count} characters too many',
    other: '{count} characters too many',
  },
}`,computed:!1}},locale:{required:!1,tsType:{name:`string`},description:`Which language's plural rule to select with.`,defaultValue:{value:`'en'`,computed:!1}},announceWithin:{required:!1,tsType:{name:`number`},description:`Start announcing once this many characters or fewer remain.`,defaultValue:{value:`20`,computed:!1}},announceDelayMs:{required:!1,tsType:{name:`number`},description:`How long the count must be still before it is announced.`,defaultValue:{value:`1000`,computed:!1}}},composes:[`Omit`]}})))()}var h,g,_,v,y,b,x,S;function C(){return(C=e((()=>{m(),a(),s(),h=t(),g=`A pocket-sized field recorder for people who write music outdoors, built from parts that can be replaced with a screwdriver.`,_={title:`Form/CharacterCount`,component:l,parameters:{layout:`padded`,docs:{description:{component:"Passing the limit changes the **wording** first and the colour second — a counter that only turns red says nothing to a colour-blind creator and nothing at all to a screen reader. The visible number is `aria-hidden`; a separate polite live region announces the remainder only once it is close, so the count never talks over the typing echo."}}},args:{count:24,limit:135},decorators:[e=>(0,h.jsx)(`div`,{className:`w-[420px]`,children:(0,h.jsx)(e,{})})]},v={},y={args:{count:129}},b={args:{count:141}},x={args:{count:124,limit:135},render:e=>(0,h.jsxs)(o,{label:`Summary`,hint:`Shown on the discovery grid and in search results. 135 characters or fewer.`,required:!0,children:[(0,h.jsx)(c,{defaultValue:g,rows:3}),(0,h.jsx)(l,{...e})]})},S=[`Default`,`NearTheLimit`,`OverTheLimit`,`InAField`],v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{}`,...v.parameters?.docs?.source},description:{story:`Well inside the limit: present, quiet, and not announced at all.`,...v.parameters?.docs?.description}}},y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    count: 129
  }
}`,...y.parameters?.docs?.source},description:{story:"Inside `announceWithin`, so the live region has something to say.",...y.parameters?.docs?.description}}},b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  args: {
    count: 141
  }
}`,...b.parameters?.docs?.source},description:{story:`Over it. The sentence changes, and only then the colour.`,...b.parameters?.docs?.description}}},x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  args: {
    count: SUMMARY.length,
    limit: 135
  },
  render: args => <Field label="Summary" hint="Shown on the discovery grid and in search results. 135 characters or fewer." required>
      <Textarea defaultValue={SUMMARY} rows={3} />
      <CharacterCount {...args} />
    </Field>
}`,...x.parameters?.docs?.source},description:{story:"Where it actually lives: under the control, inside the `Field`.",...x.parameters?.docs?.description}}}})))()}C();export{v as Default,x as InAField,y as NearTheLimit,b as OverTheLimit,S as __namedExportsOrder,_ as default};