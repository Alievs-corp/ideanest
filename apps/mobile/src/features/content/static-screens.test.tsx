import type { ReactElement, ReactNode } from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { siteUrl } from '../../api/config';
import { RichParagraph, textOf } from '../../components/content/static-page';
import { setLocale } from '../../lib/locale';
import { AboutScreen, HowItWorksScreen, TrustSafetyScreen } from './static-screens';

/**
 * About, How it works and Trust and safety — issue #164: every block in the web's order from the
 * catalogue, bold and inline links through `RichParagraph`, links that are also accessibility
 * actions, and the header's share.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    // The header's right-hand action, drawn in the tree so a test can press it.
    Stack: Object.assign(() => null, {
      Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
        options?.headerRight === undefined ? null : React.createElement(React.Fragment, null, options.headerRight()),
    }),
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

beforeEach(async () => {
  await act(async () => setLocale('en'));
  mockPush.mockReset();
});

async function show(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        {ui}
      </IntlProvider>
    </SafeAreaProvider>,
  );
}

const headers = () => screen.getAllByRole('header').map((node) => textOf(node.props.children));

describe('About', () => {
  const A = en.static.about;

  it('draws the title, then every section heading in the web’s order', async () => {
    await show(<AboutScreen />);
    expect(headers()).toEqual([
      A.title,
      A.allOrNothing.heading,
      A.cost.heading,
      A.notAPurchase.heading,
      A.next.heading,
    ]);
    expect(screen.getByText(A.summary)).toBeTruthy();
    expect(screen.getByText(A.intro)).toBeTruthy();
  });

  it('opens the app’s own pages from its inline links', async () => {
    await show(<AboutScreen />);
    await fireEvent.press(screen.getByRole('link', { name: 'Plans and pricing' }));
    expect(mockPush).toHaveBeenLastCalledWith('/pricing');
    await fireEvent.press(screen.getByRole('link', { name: 'How it works' }));
    expect(mockPush).toHaveBeenLastCalledWith('/how-it-works');
    await fireEvent.press(screen.getByRole('link', { name: 'Trust and safety' }));
    expect(mockPush).toHaveBeenLastCalledWith('/trust-safety');
  });

  it('shares the page’s https address in the reader’s language', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await show(<AboutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: en.mobile.content.share }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${siteUrl()}/en/about`, title: A.title }));
    share.mockRestore();
  });
});

describe('How it works', () => {
  const H = en.static.howItWorks;

  it('draws every section heading in order and links to the guarded account pages', async () => {
    await show(<HowItWorksScreen />);
    expect(headers()).toEqual([
      H.title,
      H.backing.heading,
      H.surveys.heading,
      H.running.heading,
      H.agreeing.heading,
    ]);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    await fireEvent.press(links[0]!);
    expect(mockPush).toHaveBeenLastCalledWith('/account/surveys');
    await fireEvent.press(links[1]!);
    expect(mockPush).toHaveBeenLastCalledWith('/account/deliveries');
  });
});

describe('Trust and safety', () => {
  const T = en.static.trustSafety;

  it('draws all six prohibitions and links the three settings pages', async () => {
    await show(<TrustSafetyScreen />);
    for (const key of ['prohibited', 'misrepresentation', 'notOwn', 'offensive', 'spam', 'fraud'] as const) {
      expect(screen.getByText(T.notAllowed[key])).toBeTruthy();
    }
    const links = screen.getAllByRole('link');
    for (const [index, path] of ['/settings/security', '/settings/sessions', '/settings/privacy'].entries()) {
      await fireEvent.press(links[index]!);
      expect(mockPush).toHaveBeenLastCalledWith(path);
    }
  });
});

describe('RichParagraph', () => {
  it('draws <b> as medium text and each link as an accessibility action on the paragraph', async () => {
    await show(
      <RichParagraph testID="rich">
        {(tag) => (
          <>
            {tag.b('Bold')} then {tag.link('/a')('first link')} and {tag.link('/b')('second')}
          </>
        )}
      </RichParagraph>,
    );
    const paragraph = screen.getByTestId('rich');
    expect(paragraph.props.accessibilityActions).toEqual([
      { name: 'link-0', label: 'first link' },
      { name: 'link-1', label: 'second' },
    ]);
    await act(async () => {
      paragraph.props.onAccessibilityAction({ nativeEvent: { actionName: 'link-1' } });
    });
    expect(mockPush).toHaveBeenLastCalledWith('/b');
  });

  it('adds no actions to a paragraph without links', async () => {
    await show(<RichParagraph testID="rich">{(tag) => tag.b('Only bold')}</RichParagraph>);
    expect(screen.getByTestId('rich').props.accessibilityActions).toBeUndefined();
  });
});
