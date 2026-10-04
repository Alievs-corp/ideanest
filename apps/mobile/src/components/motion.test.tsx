import { renderHook } from '@testing-library/react-native';
import { FIRST_SCREENFUL, useFirstScreenfulIndex } from './motion';

describe('useFirstScreenfulIndex', () => {
  it('freezes the index each item had on the first non-empty render', async () => {
    const hook = await renderHook(({ keys }: { keys: readonly string[] }) => useFirstScreenfulIndex(keys), {
      initialProps: { keys: [] as readonly string[] },
    });
    await hook.rerender({ keys: ['a', 'b'] });
    await hook.rerender({ keys: ['new', 'b', 'a'] });
    expect(hook.result.current('a')).toBe(0);
    expect(hook.result.current('b')).toBe(1);
  });

  it('keeps items that arrive later, from a refresh, past the first screenful', async () => {
    const hook = await renderHook(({ keys }: { keys: readonly string[] }) => useFirstScreenfulIndex(keys), {
      initialProps: { keys: ['a'] },
    });
    await hook.rerender({ keys: ['new', 'a'] });
    expect(hook.result.current('new')).toBe(FIRST_SCREENFUL);
  });
});
