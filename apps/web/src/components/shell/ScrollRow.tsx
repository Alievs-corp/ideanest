'use client';

import type { ComponentPropsWithoutRef } from 'react';
import { revealFocusedItem } from '../../lib/scroll-row';

/**
 * A sideways-scrolling `<ul>` that brings a focused item fully into view — issue #181.
 *
 * For a server component's row. A client component puts `revealFocusedItem` on its own row
 * directly; `CampaignTabs` renders on the server and cannot hold a handler, so it renders this
 * instead. Only the list becomes a client boundary: its items stay server-rendered and arrive
 * as children, so the tabs are still in the HTML for a reader whose JavaScript never arrives.
 */
export function ScrollRow(props: Omit<ComponentPropsWithoutRef<'ul'>, 'onFocus'>) {
  return <ul {...props} onFocus={revealFocusedItem} />;
}
