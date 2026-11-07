import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AudienceTracker } from './AudienceTracker';
import { AudienceView } from './AudienceView';
import { audienceClickAttributes } from '../../lib/audience/paths';

// The language-free pathname, as `i18n/navigation` hands it over.
const navigation = vi.hoisted(() => ({ pathname: '/discover' }));
vi.mock('../../i18n/navigation', () => ({ usePathname: () => navigation.pathname }));

const sent = vi.hoisted(() => vi.fn());
vi.mock('../../lib/audience/beacon', () => ({ sendAudienceEvent: sent }));

beforeEach(() => {
  sent.mockClear();
  navigation.pathname = '/discover';
});

afterEach(cleanup);

describe('AudienceTracker', () => {
  it('counts a page once per address, and again when the address changes', () => {
    const { rerender } = render(<AudienceTracker />);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenLastCalledWith({ kind: 'VISIT' });

    // A re-render at the same address is not a second visit.
    rerender(<AudienceTracker />);
    expect(sent).toHaveBeenCalledTimes(1);

    navigation.pathname = '/projects/sound-lab/a-field-recorder';
    rerender(<AudienceTracker />);
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('does not count the console or a campaign dashboard', () => {
    navigation.pathname = '/admin/audience';
    const { rerender } = render(<AudienceTracker />);
    navigation.pathname = '/projects/0193a3b4/dashboard/charts';
    rerender(<AudienceTracker />);

    expect(sent).not.toHaveBeenCalled();
  });

  it('sends a click with the listing a followed card link was on', () => {
    const { getByText } = render(
      <>
        <AudienceTracker />
        <a href="#campaign" {...audienceClickAttributes('p-7', 'CATEGORY')}>
          <span>A field recorder</span>
        </a>
        <a href="#elsewhere">Somewhere else</a>
      </>,
    );
    sent.mockClear();

    // The click lands on a child of the link, as a real one on the title's text does.
    fireEvent.click(getByText('A field recorder'));
    expect(sent).toHaveBeenCalledWith({ kind: 'CLICK', projectId: 'p-7', surface: 'CATEGORY' });

    // A link that is not a card is nothing to count.
    fireEvent.click(getByText('Somewhere else'));
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('counts a middle click into a new tab, but not a right click', () => {
    const { getByText } = render(
      <>
        <AudienceTracker />
        <a href="#campaign" {...audienceClickAttributes('p-7', 'HOME')}>
          Open
        </a>
      </>,
    );
    sent.mockClear();

    fireEvent(getByText('Open'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    fireEvent(getByText('Open'), new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith({ kind: 'CLICK', projectId: 'p-7', surface: 'HOME' });
  });

  it('stops listening when it unmounts', () => {
    const link = document.createElement('a');
    Object.entries(audienceClickAttributes('p-1', 'SAVED')).forEach(([name, value]) => link.setAttribute(name, value));
    document.body.append(link);
    const { unmount } = render(<AudienceTracker />);
    unmount();
    sent.mockClear();

    fireEvent.click(link);
    expect(sent).not.toHaveBeenCalled();
    link.remove();
  });
});

describe('AudienceView', () => {
  it('counts the campaign once per mount, not per render', () => {
    const { rerender } = render(<AudienceView projectId="p-1" />);
    rerender(<AudienceView projectId="p-1" />);

    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith({ kind: 'VIEW', projectId: 'p-1' });
  });

  it('renders nothing', () => {
    const { container } = render(<AudienceView projectId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
