import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONSOLE_GROUPS, CONSOLE_LINK_CAPABILITIES } from '../../lib/admin/navigation';
import {
  ROLE_CAPABILITIES,
  type StaffCapability,
  type StaffMembership,
  type StaffRole,
} from '../../lib/admin/staff';
import { adminShellCopyFrom } from '../../lib/i18n/admin-copy';
import { translatorFor } from '../../test-copy';
import { AdminNav } from './AdminNav';
import { ConsoleMembershipProvider } from './ConsoleMembership';

/**
 * The console's rail reaches its own bottom.
 *
 * <p>`sticky` pins the rail below the header and keeps it there while the page moves, which
 * is the point of it; the consequence was that a rail taller than the viewport had a bottom
 * nobody could reach — scrolling the page moved the screen on the right and left the rail
 * exactly where it was. `AccountNav` hit this with thirteen destinations in #349. This one
 * has twenty-six across six groups, so the last group or two were unreachable on an ordinary
 * viewport rather than at a particular zoom level.
 *
 * <p>Asserting on class names is not something this codebase does often, and it is right
 * here for the reason it is elsewhere rare: the behaviour is a layout property that jsdom
 * does not implement, so there is nothing else to observe. What the assertions pin is the
 * *pair* — a scroll container and the height that bounds it — because either alone is the
 * defect. A `max-height` with no `overflow-y` clips the rail instead of scrolling it, and an
 * `overflow-y` with no bound never scrolls at all.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive: `i18n/navigation.ts` builds its
   * wrappers at import time and reads `redirect` while doing so, and a factory that replaced
   * the module wholesale left those undefined.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/admin/audit',
}));

const COPY = adminShellCopyFrom(translatorFor('admin'));

/**
 * A reader holding these roles, as `GET /v1/admin/me` would describe them.
 *
 * <p>The capabilities are unioned from `ROLE_CAPABILITIES` rather than listed, which is what
 * makes these tests statements about the role model instead of about a fixture: widen
 * `CURATOR` in `staff.ts` and the curator's rail widens here without anybody editing this
 * file, and the assertion that they cannot see the ledger fails the moment it stops being
 * true.
 */
function reader(...roles: readonly StaffRole[]): StaffMembership {
  const capabilities = new Set<StaffCapability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role]) capabilities.add(capability);
  }

  return {
    accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    staff: true,
    bootstrapped: false,
    roles: [...roles],
    capabilities: [...capabilities],
  };
}

/** The rail as one reader meets it. `null` is the beat before the membership arrives. */
function renderRail(membership: StaffMembership | null): void {
  render(
    <ConsoleMembershipProvider
      given={{ status: membership === null ? 'loading' : 'ready', membership }}
    >
      <AdminNav copy={COPY} />
    </ConsoleMembershipProvider>,
  );
}

const ADMINISTRATOR = reader('ADMINISTRATOR');

describe('the console rail', () => {
  it('is its own scroll container above the breakpoint, bounded by the viewport', () => {
    renderRail(ADMINISTRATOR);

    const rail = screen.getByRole('navigation', { name: COPY.navLabel });

    // `100dvh` and not `100vh`: the dynamic unit tracks a collapsing browser toolbar, and
    // `vh` would size the rail to a viewport the reader does not have.
    expect(rail.className).toContain('lg:max-h-[calc(100dvh-4rem)]');
    expect(rail.className).toContain('lg:overflow-y-auto');
    // Without `overscroll-contain`, reaching the end of the rail hands the wheel to the page
    // and scrolls the screen nobody was looking at.
    expect(rail.className).toContain('lg:overscroll-contain');
  });

  it('keeps room for the focus ring the scroll container would otherwise clip', () => {
    renderRail(ADMINISTRATOR);

    const rail = screen.getByRole('navigation', { name: COPY.navLabel });

    // The links take `outline-2 outline-offset-2` — four pixels outside their own box — and
    // docs/ui-kit.md §9.3 requires that ring visible on every interactive element. The
    // negative margin gives the padding back, so nothing moves.
    expect(rail.className).toContain('lg:px-1');
    expect(rail.className).toContain('lg:-mx-1');
  });

  it('still draws every destination for a reader who holds every capability', () => {
    renderRail(ADMINISTRATOR);

    const destinations = CONSOLE_GROUPS.flatMap((group) => group.links);

    // If this count ever drops, the rail got shorter and somebody should say why rather
    // than the scroll quietly becoming decoration.
    expect(new Set(destinations).size).toBeGreaterThanOrEqual(26);
    for (const link of destinations) {
      expect(screen.getByRole('link', { name: COPY.links[link] })).toBeInTheDocument();
    }
  });
});

/**
 * The rail a reader can actually use — §4.11's role model, issue #295.
 *
 * <p>`lib/admin/navigation.ts` carries the argument, including the decision this reverses. The
 * failure these assert is the one that matters in each direction: a curator offered the
 * platform's books, and a member of staff losing a screen that is theirs.
 */
describe('the rail and what the reader may open', () => {
  it('draws nothing at all until the membership arrives', () => {
    // Not the full rail and not a skeleton: a rail drawn from a guess rearranges itself a beat
    // later, and the generous guess offers entries a curator may not open and then takes them
    // away. docs/motion-system.md §5 gives this surface no movement.
    renderRail(null);

    expect(screen.queryByRole('navigation', { name: COPY.navLabel })).not.toBeInTheDocument();
  });

  it('gives a curator the curation screens, the trail, and nothing else', () => {
    renderRail(reader('CURATOR'));

    for (const link of ['/admin/curation', '/admin/curation/badges', '/admin/taxonomy', '/admin/audit']) {
      expect(screen.getByRole('link', { name: COPY.links[link] })).toBeInTheDocument();
    }

    // The three this file exists to keep away from somebody whose whole role is CURATE: the
    // platform's books, what it charges, and the authority to grant itself the rest.
    for (const link of ['/admin/ledger', '/admin/fees', '/admin/staff', '/admin/users']) {
      expect(screen.queryByRole('link', { name: COPY.links[link] })).not.toBeInTheDocument();
    }
  });

  it('gives finance the money screens and not the moderation queues', () => {
    renderRail(reader('FINANCE'));

    for (const link of ['/admin/ledger', '/admin/payments', '/admin/refunds', '/admin/disputes']) {
      expect(screen.getByRole('link', { name: COPY.links[link] })).toBeInTheDocument();
    }
    for (const link of ['/admin/moderation', '/admin/curation', '/admin/staff']) {
      expect(screen.queryByRole('link', { name: COPY.links[link] })).not.toBeInTheDocument();
    }
  });

  it('draws the chargeback screen for the role that holds only half of it', () => {
    /*
     * `/admin/disputes` is one page over two reads the service guards separately, and
     * MANAGE_DISPUTES opens the second. Hiding the screen from somebody whose job is
     * answering chargebacks would be the table getting the "either" rule backwards.
     */
    render(
      <ConsoleMembershipProvider
        given={{
          status: 'ready',
          membership: { ...reader('CURATOR'), capabilities: ['MANAGE_DISPUTES'] },
        }}
      >
        <AdminNav copy={COPY} />
      </ConsoleMembershipProvider>,
    );

    expect(
      screen.getByRole('link', { name: COPY.links['/admin/disputes'] }),
    ).toBeInTheDocument();
  });

  it('drops a heading whose every entry is gone', () => {
    renderRail(reader('CURATOR'));

    // "Money" over nothing tells a curator there is money in here somewhere and they may not
    // see it, which is true and useless. The staff screen is where what somebody holds is
    // explained.
    expect(screen.queryByRole('heading', { name: COPY.groups.money })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: COPY.groups.curation })).toBeInTheDocument();
  });

  it('draws no navigation for somebody who holds nothing', () => {
    // A member of staff with every role withdrawn, which is what an account mid-revocation
    // looks like. An empty `<nav>` is a landmark an assistive technology still offers to jump
    // to, and there would be nothing there when it did.
    renderRail({ ...ADMINISTRATOR, roles: [], capabilities: [] });

    expect(screen.queryByRole('navigation', { name: COPY.navLabel })).not.toBeInTheDocument();
  });

  it('says what every destination needs, exactly once', () => {
    /*
     * The invariant that keeps the table from being a way to lose a screen: `mayOpenConsoleLink`
     * fails closed, so an entry nobody filed here would disappear from every rail and nothing
     * else would say so. The other direction — a capability named for an entry the rail does
     * not have — is a line somebody forgot to delete.
     */
    const destinations = CONSOLE_GROUPS.flatMap((group) => group.links);

    for (const link of destinations) {
      const wanted = CONSOLE_LINK_CAPABILITIES[link];
      expect(wanted, `${link} is in the rail and names no capability`).toBeTruthy();
      expect(wanted?.length, `${link} names an empty capability list`).toBeGreaterThan(0);
    }

    expect(Object.keys(CONSOLE_LINK_CAPABILITIES).sort()).toEqual([...destinations].sort());
  });
});
