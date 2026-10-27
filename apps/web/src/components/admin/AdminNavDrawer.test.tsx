import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ROLE_CAPABILITIES, type StaffMembership } from '../../lib/admin/staff';
import { adminShellCopyFrom } from '../../lib/i18n/admin-copy';
import { translatorFor } from '../../test-copy';
import { AdminNavDrawer } from './AdminNavDrawer';
import { ConsoleMembershipProvider } from './ConsoleMembership';

/**
 * The console's navigation on a phone: a menu button in the bar and a panel holding the rail.
 *
 * <p>What is asserted is the focus contract docs/ui-kit.md §7.14 gives a drawer, and that the
 * panel carries the three things the bar stops drawing below the breakpoint — the rail, the
 * reader line's place and the way back to the site.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/admin/audit',
}));

const COPY = adminShellCopyFrom(translatorFor('admin'));

const SUPER_ADMIN: StaffMembership = {
  accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  staff: true,
  bootstrapped: false,
  roles: ['SUPER_ADMIN'],
  capabilities: [...ROLE_CAPABILITIES.SUPER_ADMIN],
};

function renderDrawer(): void {
  render(
    <ConsoleMembershipProvider given={{ status: 'ready', membership: SUPER_ADMIN }}>
      <AdminNavDrawer copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

describe('the console drawer', () => {
  it('is a named menu button that is hidden above the breakpoint, and nothing else until pressed', () => {
    renderDrawer();

    const button = screen.getByRole('button', { name: COPY.openMenu });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveClass('xl:hidden');
    // Not mounted while closed, so its links are not tab stops for anybody who never opens it.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens a modal panel with the rail and the way back to the site, and moves focus into it', () => {
    renderDrawer();

    const button = screen.getByRole('button', { name: COPY.openMenu });
    fireEvent.click(button);

    const dialog = screen.getByRole('dialog', { name: COPY.navLabel });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    expect(screen.getByRole('navigation', { name: COPY.navLabel })).toBeInTheDocument();
    expect(screen.getByRole('link', { current: 'page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.backToSite })).toBeInTheDocument();
  });

  it('closes on Escape and on its close button, and hands focus back to the menu button', () => {
    renderDrawer();
    const button = screen.getByRole('button', { name: COPY.openMenu });

    // A real press focuses the button first, and that is the element focus returns to.
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);

    button.focus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: COPY.closeMenu }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
