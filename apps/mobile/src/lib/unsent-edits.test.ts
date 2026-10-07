import { memoryStore } from './storage';
import { forgetUnsentEdits, heldKeyFor, unsentKeyFor } from './unsent-edits';

describe('forgetUnsentEdits', () => {
  it('erases every unsent change and every held draft when the session ends, and nothing else', () => {
    const store = memoryStore();
    store.set(unsentKeyFor('p1'), '{}');
    store.set(heldKeyFor('p1', 'story'), '{}');
    store.set(heldKeyFor('p2', 'story'), '{}');
    store.set('ideanest.other', 'kept');

    forgetUnsentEdits(store);

    expect(store.getAllKeys()).toEqual(['ideanest.other']);
  });
});
