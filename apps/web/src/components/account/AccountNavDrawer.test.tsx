import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@ideanest/messages/en.json';
import { AccountNavDrawer } from './AccountNavDrawer';
import type { AccountNavGroup } from './AccountNav';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/settings/security',
}));

const GROUPS: readonly AccountNavGroup[] = [
  {
    heading: en.account.groups.settings,
    links: [
      { href: '/settings/profile', label: en.account.links.profile.label },
      { href: '/settings/security', label: en.account.links.security.label },
    ],
  },
];

function renderDrawer(): void {
  render(
    <AccountNavDrawer
      label={en.account.nav.label}
      openLabel={en.account.nav.open}
      closeLabel={en.account.nav.close}
      groups={GROUPS}
    />,
  );
}

describe('the account drawer', () => {
  it('names the page being read on its button and is hidden at xl', () => {
    renderDrawer();

    const button = screen.getByRole('button', { name: `${en.account.nav.open}: ${en.account.links.security.label}` });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.parentElement).toHaveClass('xl:hidden');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog with every entry, marks the current one, and closes again', () => {
    renderDrawer();

    const button = screen.getByRole('button', { name: new RegExp(en.account.nav.open) });
    fireEvent.click(button);

    const dialog = screen.getByRole('dialog', { name: en.account.nav.label });
    const links = within(dialog).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/settings/profile', '/en/settings/security']);
    expect(within(dialog).getByRole('link', { current: 'page' })).toHaveAttribute('href', '/en/settings/security');
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: en.account.nav.close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.account.nav.open) }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the window widens to the rail, so the page is not left scroll-locked', () => {
    const listeners: Array<() => void> = [];
    const query = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => query);
    try {
      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: new RegExp(en.account.nav.open) }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      query.matches = true;
      act(() => listeners.forEach((listener) => listener()));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
