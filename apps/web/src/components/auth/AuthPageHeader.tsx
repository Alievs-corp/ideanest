import type { ReactNode } from 'react';

/**
 * The heading pair every authentication screen opens with.
 *
 * A page title and one sentence of context, in one place so that four screens cannot end up
 * with four type scales. `h1` because each of these routes is a page in its own right — a
 * screen whose only heading is an `h2` is a document with no title to a screen reader.
 */
export function AuthPageHeader({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-fg sm:text-3xl">{title}</h1>
      {children !== undefined && (
        <p className="mt-3 text-[15px] leading-relaxed text-fg-64">{children}</p>
      )}
    </div>
  );
}
