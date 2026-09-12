import type { Metadata } from 'next';
import { NewProjectForm } from '../../../../components/campaign-editor/NewProjectForm';
import {
  editorChromeCopy,
  newProjectCopy,
} from '../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const copy = await newProjectCopy();
  return privatePageMetadata({ title: copy.heading, description: copy.metaDescription });
}

/**
 * A shell around a client form.
 *
 * Creating a draft needs the account's access token, which lives in memory in
 * the browser and nowhere else (`src/lib/api/access-token.ts`), so there is
 * nothing here a server render could do.
 */
export default async function NewProjectPage() {
  const [chrome, copy] = await Promise.all([editorChromeCopy(), newProjectCopy()]);

  return (
    /*
      A `<div>` and not a `<main>` since #347. `app/projects/new/layout.tsx` puts this page
      inside `SiteShell`, which owns the only `<main>` on the document and is the skip link's
      target. The column width and the padding stay here: the shell sets neither.
    */
    <div className="mx-auto w-full max-w-[560px] px-5 py-10 sm:px-6 sm:py-14">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
        {copy.heading}
      </h1>
      <p className="mt-2 text-sm text-white/64">
        {copy.intro}
      </p>

      <NewProjectForm
        copy={copy}
        counter={chrome.characterCount}
        locale={chrome.locale}
      />
    </div>
  );
}
