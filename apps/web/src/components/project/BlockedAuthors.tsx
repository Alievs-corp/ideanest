'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { blockedIds } from '../../lib/community/blocks';
import { useSession } from '../session/SessionProvider';

/**
 * Hiding the comments of the people this reader blocked — §4.9's C-08, issue #324.
 *
 * <h2>Why in the browser, when the service already filters</h2>
 *
 * The service leaves a blocked account's comments out of every read the blocker makes — but
 * only a read that carries the blocker's token. This tab is read on the server, anonymously,
 * because a campaign's conversation is public content in the initial HTML
 * (`lib/community/comments.ts` argues it), and the server never holds the reader's token. So
 * the page that arrives is everybody's page, and the reader's own blocks are applied here:
 * one read of their list once the session is known, and each comment drawn through
 * {@link HiddenIfBlocked}.
 *
 * <h2>The page is drawn first, and then thinned</h2>
 *
 * Until the list has answered every comment shows, which is what the server rendered and what
 * a visitor sees. Hiding everything until then would blank the tab for every signed-in reader
 * on every load — nearly all of whom have blocked nobody — to spare the few who have a moment
 * of a comment they chose not to read. The moment is named in the pull request rather than
 * hidden; the app has no such moment, because its reads carry the token.
 *
 * <h2>Blocking from here is immediate</h2>
 *
 * {@link BlockedAuthorsContext.add} puts an id into the set as soon as the service has agreed,
 * so the comments of the person just blocked leave the page without a reload — and a reload
 * would read the same list and agree.
 */

interface BlockedAuthorsContext {
  /** Whether this reader has blocked the account that wrote a comment. */
  readonly isBlocked: (authorId: string | null) => boolean;
  /**
   * Records a block the service has just accepted, so the page reflects it at once, and says
   * so in {@link BlockNotice}. The sentence cannot live beside the button that caused it: the
   * button leaves the page with the comment it was under.
   */
  readonly add: (authorId: string, notice: string) => void;
  /** The sentence said after the last block, or `null`. */
  readonly notice: string | null;
}

const Context = createContext<BlockedAuthorsContext | null>(null);

/** The context, or `null` outside a comments tab — where nothing offers a block. */
export function useBlockedAuthors(): BlockedAuthorsContext | null {
  return useContext(Context);
}

export function BlockedAuthorsProvider({ children }: { readonly children: ReactNode }) {
  const { status, session } = useSession();
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'signed-in') {
      setBlocked(new Set());
      return;
    }

    const controller = new AbortController();
    blockedIds(controller.signal)
      .then((ids) => {
        if (!controller.signal.aborted) setBlocked(ids);
      })
      .catch(() => {
        // Unread is not "blocked nobody", but there is nothing better to show than the page
        // everybody else sees, which is what is already on screen.
      });
    return () => controller.abort();
    // The account, not the session object: a token refresh is not a different reader.
  }, [status, session?.id]);

  const add = useCallback((authorId: string, said: string) => {
    setBlocked((previous) => new Set(previous).add(authorId));
    setNotice(said);
  }, []);

  const value = useMemo<BlockedAuthorsContext>(
    () => ({
      isBlocked: (authorId) => authorId !== null && blocked.has(authorId),
      add,
      notice,
    }),
    [blocked, add, notice],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The polite live region a block is announced in, placed by the tab.
 *
 * Always in the document, for `FollowControl`'s reason — a region mounted at the moment of
 * speaking is one most screen readers never announce. Visually hidden while it has nothing to
 * say, which also keeps it out of the tab's flex gap; visible once it has, because the comments
 * that just disappeared deserve a sentence on screen as well as in a screen reader.
 */
export function BlockNotice() {
  const notice = useBlockedAuthors()?.notice ?? null;
  return (
    <p aria-live="polite" className={notice === null ? 'sr-only' : 'text-sm text-white/64'}>
      {notice}
    </p>
  );
}

/**
 * Draws its children unless this reader blocked the comment's author.
 *
 * Wraps a whole conversation for a root — the service leaves a blocked account's conversation
 * out whole, replies included, and so does this — and a single row for a reply.
 */
export function HiddenIfBlocked({
  authorId,
  children,
}: {
  readonly authorId: string | null;
  readonly children: ReactNode;
}) {
  const blocked = useBlockedAuthors();
  if (blocked?.isBlocked(authorId)) return null;
  return <>{children}</>;
}
