import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MARKET_COOKIE } from '@ideanest/messages/country';
import { shellCopyFrom } from '../../lib/i18n/shell-copy';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { rememberPageMarket } from '../../lib/market/cookie';
import { CountrySwitcher } from './CountrySwitcher';
import { MarketEmptyNotice } from './MarketEmptyNotice';
import { MarketSeed } from './MarketSeed';

/**
 * The country control and the empty-list notice — issue #533.
 *
 * Both read the reader's cookie, then the market the page was rendered for (handed over by
 * `MarketSeed`, never a cookie — #641), and choosing writes the reader's cookie; a page that
 * lists campaigns is reloaded so its lists are read again.
 */

const copy = shellCopyFrom(translatorFor('shell')).market;

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
  usePathname: () => '/discover',
}));

const reload = vi.fn();

beforeEach(() => {
  document.cookie = `${MARKET_COOKIE}=; Path=/; Max-Age=0`;
  rememberPageMarket(null);
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, pathname: '/en/discover', reload });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CountrySwitcher', () => {
  it('names the country the page was narrowed to, before anybody chose one', async () => {
    // The header comes before the page, so the switcher renders before the page's seed does.
    render(
      <>
        <CountrySwitcher copy={copy} />
        <MarketSeed market="GE" />
      </>,
    );

    const trigger = await screen.findByRole('button', { name: 'Choose a country. Country: Georgia' });
    expect(trigger).toHaveTextContent('GE');
    expect(document.cookie).not.toContain('ideanest_country');
  });

  it('follows a page that arrives later, as a client-side navigation brings one', async () => {
    const view = render(<CountrySwitcher copy={copy} />);
    expect(await screen.findByRole('button', { name: 'Choose a country. Country: Azerbaijan' })).toBeInTheDocument();

    act(() => {
      view.rerender(
        <>
          <CountrySwitcher copy={copy} />
          <MarketSeed market="DE" />
        </>,
      );
    });

    expect(await screen.findByRole('button', { name: 'Choose a country. Country: Germany' })).toHaveTextContent('DE');
  });

  it('keeps the reader’s own choice over the market the page was rendered for', async () => {
    document.cookie = `${MARKET_COOKIE}=TR; Path=/`;
    render(
      <>
        <CountrySwitcher copy={copy} />
        <MarketSeed market="DE" />
      </>,
    );

    expect(await screen.findByRole('button', { name: 'Choose a country. Country: Türkiye' })).toHaveTextContent('TR');
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
    render(
      <>
        <MarketSeed market="DE" />
        <MarketEmptyNotice copy={copy} />
      </>,
    );

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
