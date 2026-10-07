import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text, View } from 'react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { ReorderButtons, useReorder } from './use-reorder';

interface Row {
  readonly id: string;
  readonly title: string;
}

const ROWS: readonly Row[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Bravo' },
  { id: 'c', title: 'Charlie' },
];

function deferred() {
  let resolve: () => void = () => {};
  let reject: (cause: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function List({
  items,
  send,
  onRefused,
  onDelete,
}: {
  readonly items: readonly Row[];
  readonly send: (ids: readonly string[]) => Promise<unknown>;
  readonly onRefused: (cause: unknown) => void;
  readonly onDelete?: (row: Row) => void;
}) {
  const reorder = useReorder<Row>({
    items,
    idOf: (row) => row.id,
    send,
    onRefused,
    announcement: (row, position, total) => `${row.title} moved to position ${position} of ${total}.`,
    labels: { moveUp: 'Move up', moveDown: 'Move down', delete: 'Delete' },
    ...(onDelete === undefined ? {} : { onDelete }),
  });
  return (
    <View>
      {reorder.items.map((row, index) => (
        <View key={row.id} testID={`card-${row.id}`} accessible {...reorder.accessibilityFor(row)}>
          <Text>{row.title}</Text>
          <ReorderButtons
            reorder={reorder}
            id={row.id}
            upLabel={`Move ${row.title} up, currently ${index + 1} of ${reorder.items.length}`}
            downLabel={`Move ${row.title} down, currently ${index + 1} of ${reorder.items.length}`}
            testID={`move-${row.id}`}
          />
        </View>
      ))}
    </View>
  );
}

async function show(props: Parameters<typeof List>[0]) {
  const view = await render(
    <IntlProvider locale="en" messages={en}>
      <List {...props} />
    </IntlProvider>,
  );
  return view;
}

const order = () => screen.getAllByTestId(/^card-/).map((card) => card.props.testID.slice(5));

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const said = () => {
  const ios = jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls.map((call) => call[0]);
  const android = jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map((call) => call[0]);
  return [...ios, ...android];
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
});

describe('useReorder', () => {
  it('moves at once, sends the full id list, and announces the new position', async () => {
    const send = jest.fn(() => Promise.resolve());
    await show({ items: ROWS, send, onRefused: jest.fn() });

    await fireEvent.press(screen.getByLabelText('Move Charlie up, currently 3 of 3'));
    expect(order()).toEqual(['a', 'c', 'b']);
    expect(send).toHaveBeenCalledWith(['a', 'c', 'b']);
    expect(said()).toEqual(['Charlie moved to position 2 of 3.']);
  });

  it('disables the moves a card cannot make', async () => {
    await show({ items: ROWS, send: jest.fn(() => Promise.resolve()), onRefused: jest.fn() });
    expect(screen.getByTestId('move-a-up').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('move-c-down').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('move-b-up').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('keeps one request in the air and queues ONE more with the latest full list', async () => {
    const first = deferred();
    const send = jest.fn<Promise<void>, [readonly string[]]>().mockReturnValueOnce(first.promise).mockResolvedValue();
    await show({ items: ROWS, send, onRefused: jest.fn() });

    await fireEvent.press(screen.getByTestId('move-c-up'));
    await fireEvent.press(screen.getByTestId('move-c-up'));
    await fireEvent.press(screen.getByTestId('move-a-down'));
    expect(order()).toEqual(['c', 'b', 'a']);
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve());
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(['c', 'b', 'a']);
  });

  it('on a refusal, shows the server’s order again and hands the cause to the caller to reload', async () => {
    const refusal = new Error('refused');
    const onRefused = jest.fn();
    await show({ items: ROWS, send: jest.fn(() => Promise.reject(refusal)), onRefused });

    await fireEvent.press(screen.getByTestId('move-b-down'));
    await settle();
    expect(onRefused).toHaveBeenCalledWith(refusal);
    expect(order()).toEqual(['a', 'b', 'c']);
  });

  it('drops the optimistic order once the server’s list arrives in it', async () => {
    const send = jest.fn(() => Promise.resolve());
    const view = await show({ items: ROWS, send, onRefused: jest.fn() });
    await fireEvent.press(screen.getByTestId('move-b-up'));
    await settle();

    const reread = [ROWS[1], ROWS[0], ROWS[2]] as Row[];
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <List items={reread} send={send} onRefused={jest.fn()} />
      </IntlProvider>,
    );
    expect(order()).toEqual(['b', 'a', 'c']);
    // A later server list wins outright: nothing optimistic is left over.
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <List items={ROWS} send={send} onRefused={jest.fn()} />
      </IntlProvider>,
    );
    expect(order()).toEqual(['a', 'b', 'c']);
  });

  it('returns screen-reader focus to the same button on the moved card', async () => {
    await show({ items: ROWS, send: jest.fn(() => Promise.resolve()), onRefused: jest.fn() });
    await fireEvent.press(screen.getByTestId('move-b-down'));
    // Past FOCUS_DELAY_MS, in real time: the kit's press feedback does not run under fake timers.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const focused = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1);
    // Moved to the end, its "down" is disabled now, so focus lands on its "up".
    // The pressable's instance; compared by its testID, since printing one on a failure never ends.
    const node = focused?.[0] as unknown as { props?: { testID?: string } } | undefined;
    expect(node?.props?.testID).toBe('move-b-up');
    expect(focused?.[1]).toBe('focus');
  });

  it('exposes moveUp, moveDown and delete as accessibility actions, and runs them', async () => {
    const send = jest.fn(() => Promise.resolve());
    const onDelete = jest.fn();
    await show({ items: ROWS, send, onRefused: jest.fn(), onDelete });

    const middle = screen.getByTestId('card-b');
    expect(middle.props.accessibilityActions).toEqual([
      { name: 'moveUp', label: 'Move up' },
      { name: 'moveDown', label: 'Move down' },
      { name: 'delete', label: 'Delete' },
    ]);
    expect(screen.getByTestId('card-a').props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'moveDown',
      'delete',
    ]);

    await fireEvent(middle, 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
    expect(send).toHaveBeenCalledWith(['a', 'c', 'b']);
    await fireEvent(screen.getByTestId('card-a'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(onDelete).toHaveBeenCalledWith(ROWS[0]);
  });
});
