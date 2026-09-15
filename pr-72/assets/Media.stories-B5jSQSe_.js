import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t}from"./iframe-Drcy5HgV.js";import{n,t as r}from"./cn-Dm4OyE3Q.js";import{a as i,n as a,r as o}from"./sample-data-6f0rXx-Z.js";function s(e){if(typeof e==`string`)return f[e];let{width:t,height:n}=e;return Number.isFinite(t)&&Number.isFinite(n)&&t>0&&n>0?`${t} / ${n}`:f[`16/9`]}function c(e){return/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(e)}function l({ratio:e,radius:t=`none`,placeholder:n,className:i,style:a,children:o,...l}){let u=n!==void 0&&c(n)?n:null;return(0,d.jsxs)(`div`,{"data-media-frame":``,className:r(`relative w-full overflow-hidden bg-surface-3`,p[t],i),style:{aspectRatio:s(e),...a},...l,children:[u!==null&&(0,d.jsx)(`span`,{"aria-hidden":`true`,"data-media-placeholder":``,className:`pointer-events-none absolute inset-0 scale-110 bg-cover bg-center blur-md`,style:{backgroundImage:`url("${u}")`}}),o]})}function u({src:e,ratio:t,radius:n=`none`,placeholder:i,fit:a=`cover`,frameClassName:o,className:s,decorative:c,alt:u,loading:f=`lazy`,...p}){return(0,d.jsx)(l,{ratio:t,radius:n,placeholder:i,className:o,children:(0,d.jsx)(`img`,{src:e,alt:c===!0?``:u,loading:f,decoding:`async`,className:r(`absolute inset-0 size-full`,a===`cover`?`object-cover`:`object-contain`,s),...p})})}var d,f,p;function m(){return(m=e((()=>{n(),d=t(),f={"16/9":`16 / 9`,"3/2":`3 / 2`,"4/3":`4 / 3`,"1/1":`1 / 1`},p={none:``,sm:`rounded-sm`,md:`rounded-md`,lg:`rounded-lg`,xl:`rounded-xl`},l.__docgenInfo={description:``,methods:[],displayName:`MediaFrame`,props:{ratio:{required:!0,tsType:{name:`union`,raw:`MediaRatioToken | IntrinsicSize`,elements:[{name:`union`,raw:`keyof typeof MEDIA_RATIOS`,elements:[{name:`literal`,value:`'16/9'`},{name:`literal`,value:`'3/2'`},{name:`literal`,value:`'4/3'`},{name:`literal`,value:`'1/1'`}]},{name:`IntrinsicSize`}]},description:"A crop token, or the image's own `{ width, height }` when it is shown whole."},radius:{required:!1,tsType:{name:`union`,raw:`keyof typeof RADIUS`,elements:[{name:`literal`,value:`none`},{name:`literal`,value:`sm`},{name:`literal`,value:`md`},{name:`literal`,value:`lg`},{name:`literal`,value:`xl`}]},description:``,defaultValue:{value:`'none'`,computed:!1}},placeholder:{required:!1,tsType:{name:`string`},description:`A low-quality image placeholder as a \`data:image/…;base64,…\` URI, painted
blurred inside the reserved box until the real image covers it. Anything
else is ignored rather than rendered.`},children:{required:!1,tsType:{name:`ReactNode`},description:`The image element. Absent renders the reserved surface and nothing else.`}},composes:[`Omit`]},u.__docgenInfo={description:`A framed \`<img>\` for surfaces with no image optimiser behind them.

The application renders project imagery through \`next/image\` inside a bare
\`MediaFrame\`, because that is where the AVIF and WebP variants come from.
This is what Storybook shows and what any non-Next consumer uses, and it
carries the same reservation, the same placeholder, and the same alt
contract so the two cannot drift.`,methods:[],displayName:`Media`,props:{src:{required:!0,tsType:{name:`string`},description:``},ratio:{required:!0,tsType:{name:`union`,raw:`MediaRatioToken | IntrinsicSize`,elements:[{name:`union`,raw:`keyof typeof MEDIA_RATIOS`,elements:[{name:`literal`,value:`'16/9'`},{name:`literal`,value:`'3/2'`},{name:`literal`,value:`'4/3'`},{name:`literal`,value:`'1/1'`}]},{name:`IntrinsicSize`}]},description:``},radius:{required:!1,tsType:{name:`union`,raw:`keyof typeof RADIUS`,elements:[{name:`literal`,value:`none`},{name:`literal`,value:`sm`},{name:`literal`,value:`md`},{name:`literal`,value:`lg`},{name:`literal`,value:`xl`}]},description:``,defaultValue:{value:`'none'`,computed:!1}},placeholder:{required:!1,tsType:{name:`string`},description:``},fit:{required:!1,tsType:{name:`union`,raw:`'cover' | 'contain'`,elements:[{name:`literal`,value:`'cover'`},{name:`literal`,value:`'contain'`}]},description:"`cover` crops to the frame; `contain` letterboxes inside it.",defaultValue:{value:`'cover'`,computed:!1}},frameClassName:{required:!1,tsType:{name:`string`},description:"Classes for the frame rather than the `<img>`."},loading:{defaultValue:{value:`'lazy'`,computed:!1},required:!1}}}})))()}var h,g,_,v,y,b,x,S,C;function w(){return(w=e((()=>{m(),i(),h=t(),g={title:`Media/Media`,component:u,parameters:{layout:`padded`,docs:{description:{component:"The reserved box is the point. Every story here has its height decided before the image arrives, so nothing under it moves when the bytes land. `ratio` takes a crop token when the surface cuts the picture and the image’s own `{ width, height }` when it shows the picture whole. Nothing animates: a card grid that cross-fades twenty-four covers is the long-list animation docs/motion-system.md §8 forbids."}}},args:{src:a,ratio:`16/9`,decorative:!0}},_={args:{ratio:`16/9`,radius:`lg`,decorative:!0}},v={args:{ratio:`16/9`,radius:`lg`,decorative:!1,alt:`A hand-built field recorder on a workbench, its lid open.`}},y={args:{ratio:`16/9`,radius:`lg`,placeholder:o,decorative:!0}},b={args:{ratio:{width:3,height:4},radius:`lg`,fit:`contain`,placeholder:o,decorative:!0},render:e=>(0,h.jsx)(`div`,{className:`max-w-[240px]`,children:(0,h.jsx)(u,{...e})})},x={render:()=>(0,h.jsx)(l,{ratio:`16/9`,radius:`lg`})},S={render:()=>(0,h.jsxs)(`div`,{className:`grid max-w-[720px] grid-cols-4 gap-4`,children:[(0,h.jsx)(u,{src:a,ratio:`16/9`,radius:`md`,decorative:!0}),(0,h.jsx)(u,{src:a,ratio:`3/2`,radius:`md`,decorative:!0}),(0,h.jsx)(u,{src:a,ratio:`4/3`,radius:`md`,decorative:!0}),(0,h.jsx)(u,{src:a,ratio:`1/1`,radius:`md`,decorative:!0})]})},C=[`Cropped`,`Described`,`WithPlaceholder`,`IntrinsicRatio`,`Empty`,`Ratios`],_.parameters={..._.parameters,docs:{..._.parameters?.docs,source:{originalSource:`{
  args: {
    ratio: '16/9',
    radius: 'lg',
    decorative: true
  }
}`,..._.parameters?.docs?.source},description:{story:`The discovery card's crop: every cover becomes 16:9 whatever was uploaded.`,..._.parameters?.docs?.description}}},v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  args: {
    ratio: '16/9',
    radius: 'lg',
    decorative: false,
    alt: 'A hand-built field recorder on a workbench, its lid open.'
  }
}`,...v.parameters?.docs?.source},description:{story:"A content image. `alt` is a sentence about what the picture shows, because a\nscreen reader otherwise reads the file name.",...v.parameters?.docs?.description}}},y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    ratio: '16/9',
    radius: 'lg',
    placeholder: SAMPLE_COVER_PLACEHOLDER,
    decorative: true
  }
}`,...y.parameters?.docs?.source},description:{story:`The placeholder, painted blurred inside the reserved box. It is a \`data:\` URI
of about half a kilobyte, so it arrives with the markup rather than as a
second request.`,...y.parameters?.docs?.description}}},b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  args: {
    ratio: {
      width: 3,
      height: 4
    },
    radius: 'lg',
    fit: 'contain',
    placeholder: SAMPLE_COVER_PLACEHOLDER,
    decorative: true
  },
  render: args => <div className="max-w-[240px]">
      <Media {...args} />
    </div>
}`,...b.parameters?.docs?.source},description:{story:`An intrinsic ratio. A portrait photograph shown whole reserves the shape it
really is; forcing it into 16:9 would be a layout shift with extra steps.`,...b.parameters?.docs?.description}}},x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <MediaFrame ratio="16/9" radius="lg" />
}`,...x.parameters?.docs?.source},description:{story:`The frame with nothing in it. A campaign with no cover gets the reserved
surface rather than a broken image or a stock graphic that says nothing — and
the card below it sits exactly where it will sit once a cover exists.`,...x.parameters?.docs?.description}}},S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  render: () => <div className="grid max-w-[720px] grid-cols-4 gap-4">
      <Media src={SAMPLE_COVER} ratio="16/9" radius="md" decorative />
      <Media src={SAMPLE_COVER} ratio="3/2" radius="md" decorative />
      <Media src={SAMPLE_COVER} ratio="4/3" radius="md" decorative />
      <Media src={SAMPLE_COVER} ratio="1/1" radius="md" decorative />
    </div>
}`,...S.parameters?.docs?.source},description:{story:`Every crop token, beside each other. There is no fifth without a design
decision, which is the rule radii and durations already follow.`,...S.parameters?.docs?.description}}}})))()}w();export{_ as Cropped,v as Described,x as Empty,b as IntrinsicRatio,S as Ratios,y as WithPlaceholder,C as __namedExportsOrder,g as default};