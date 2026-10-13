/**
 * What the bank charged for a transfer, as typed into a record form — #401.
 *
 * <p>Optional, so blank is no fee. A comma is read as the decimal mark, because the statement
 * finance copies it from is Azerbaijani. Money crosses the API as a decimal string with at most two
 * places, which is what the service accepts; anything else is refused here rather than sent.
 *
 * @returns the fee to send, `null` for none, or `undefined` when the input is not an amount
 */
export function bankFeeFrom(input: string): string | null | undefined {
  const typed = input.trim().replace(',', '.');
  if (typed === '') return null;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(typed)) return undefined;
  return /^0+(\.0+)?$/.test(typed) ? null : typed;
}
