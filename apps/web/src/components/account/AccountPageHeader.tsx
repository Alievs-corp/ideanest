import type { ReactNode } from 'react';

/**
 * The heading every account screen opens with — one place, so eight screens cannot spell the
 * same thing eight ways.
 *
 * `AuthPageHeader` is the same idea for `app/(auth)`, and this is deliberately not that
 * component: the authentication screens are centred in a 26rem column and these are the left
 * of a two-column working surface, so the type scale and the alignment differ. Sharing one
 * component between them would mean a prop deciding which screen it was on.
 */
export interface AccountPageHeaderProps {
  readonly title: string;
  readonly children?: ReactNode;
}

export function AccountPageHeader({ title, children }: AccountPageHeaderProps) {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-fg sm:text-3xl">{title}</h1>
      {children !== undefined && (
        <p className="mt-2 max-w-[58ch] text-sm text-fg-64">{children}</p>
      )}
    </header>
  );
}
