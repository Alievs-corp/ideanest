/**
 * The two ways the editor's cached lists change after a write — items, rewards, questions (#162).
 * The service answers every save with the saved entry; the list is updated with it rather than
 * read again, so the screen does not flicker back to a skeleton after each save.
 */

/** The list with `saved` in place of its old self, or appended when it is new. */
export function upsert<T extends { readonly id: string }>(list: readonly T[] | undefined, saved: T): readonly T[] {
  const current = list ?? [];
  return current.some((entry) => entry.id === saved.id)
    ? current.map((entry) => (entry.id === saved.id ? saved : entry))
    : [...current, saved];
}

/** The list in the order `ids` gives; anything `ids` does not name stays, at the end. */
export function inOrder<T extends { readonly id: string }>(
  list: readonly T[] | undefined,
  ids: readonly string[],
): readonly T[] {
  const current = list ?? [];
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const ordered = ids.flatMap((one) => {
    const entry = byId.get(one);
    return entry === undefined ? [] : [entry];
  });
  return [...ordered, ...current.filter((entry) => !ids.includes(entry.id))];
}
