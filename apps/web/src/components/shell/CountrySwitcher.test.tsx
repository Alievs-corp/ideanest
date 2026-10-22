import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DETECTED_MARKET_COOKIE, MARKET_COOKIE } from '@ideanest/messages/country';
import { shellCopyFrom } from '../../lib/i18n/shell-copy';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { CountrySwitcher } from './CountrySwitcher';
import { MarketEmptyNotice } from './MarketEmptyNotice';

/**
 * The country control and the empty-list notice — issue #533.
 *
 * Both read the market from the cookies the proxy reads, and choosing writes the reader's
 * cookie; a page that lists campaigns is reloaded so its lists are read again.
 */

const copy = shellCopyFrom(translatorFor('shell')).market;

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
  usePathname: () => '/discover',
}));

const reload = vi.fn();

function clearCookies(): void {
  for (const name of [MARKET_COOKIE, DETECTED_MARKET_COOKIE]) document.cookie = `${name}=; Path=/; Max-Age=0`;
}

beforeEach(() => {
  clearCookies();
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, pathname: '/en/discover', reload });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CountrySwitcher', () => {
  it('names the country the page was narrowed to, before anybody chose one', async () => {
    document.cookie = `${DETECTED_MARKET_COOKIE}=GE; Path=/`;
    render(<CountrySwitcher copy={copy} />);

    const trigger = await screen.findByRole('button', { name: 'Choose a country. Country: Georgia' });
    expect(trigger).toHaveTextContent('GE');
  });

  it('opens the list from the drawer row’s words, not only from the badge', async () => {
    const view = render(<CountrySwitcher copy={copy} rowLabel={copy.label} />);
    await expectNoViolations(view.container);

    await userEvent.click(await screen.findByText(copy.label));

    expect(await screen.findByRole('button', { name: copy.all })).toBeInTheDocument();
  });

  it('lists every country by name with every country on top, and filters by name', async () => {
    const view = render(<CountrySwitcher copy={copy} />);
    await userEvent.click(await screen.findByRole('button', { name: /Choose a country/ }));

    const all = await screen.findByRole('button', { name: copy.all });
    expect(all).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Azerbaijan' })).toHaveAttribute('aria-current', 'true');

    await userEvent.type(screen.getByRole('textbox', { name: copy.filter }), 'georg');
    expect(screen.getByRole('button', { name: 'Georgia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Azerbaijan' })).not.toBeInTheDocument();

    await expectNoViolations(view.container);
  });

  it('remembers the choice and reads the page’s lists again', async () => {
    render(<CountrySwitcher copy={copy} />);
    await userEvent.click(await screen.findByRole('button', { name: /Choose a country/ }));
    await userEvent.click(await screen.findByRole('button', { name: copy.all }));

    expect(document.cookie).toContain(`${MARKET_COOKIE}=ALL`);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('MarketEmptyNotice', () => {
  it('says which country the list was for and offers every country', async () => {
    document.cookie = `${DETECTED_MARKET_COOKIE}=DE; Path=/`;
    render(<MarketEmptyNotice copy={copy} />);

    expect(await screen.findByText('No campaigns for Germany yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: copy.emptyAction }));

    expect(document.cookie).toContain(`${MARKET_COOKIE}=ALL`);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('says nothing to a reader who already browses every country', () => {
    document.cookie = `${MARKET_COOKIE}=ALL; Path=/`;
    const { container } = render(<MarketEmptyNotice copy={copy} />);
    expect(container).toBeEmptyDOMElement();
  });
});
